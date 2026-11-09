import base64, json, io, urllib.error, urllib.request
from openpyxl import Workbook
from PIL import Image
import os
BASE=os.getenv('COLLECTPLUS_TEST_BASE','http://127.0.0.1:8000')
AUTH='Basic '+base64.b64encode(b'ci-admin:ci-password-test-only').decode()
def req(path, method='GET', data=None, auth=True):
    headers={'Content-Type':'application/json'}
    if auth is True: headers['Authorization']=AUTH
    elif isinstance(auth,str): headers['Authorization']=auth
    body=None if data is None else json.dumps(data).encode()
    request=urllib.request.Request(BASE+path,data=body,headers=headers,method=method)
    try:
        with urllib.request.urlopen(request) as r: return r.status, r.read()
    except urllib.error.HTTPError as e: return e.code,e.read()
# Health endpoint remains public; admin APIs require credentials.
assert req('/api/health',auth=False)[0] == 200
assert req('/api/forms',auth=False)[0] == 401
assert req('/api/forms',auth='Basic '+base64.b64encode(b'ci-admin:wrong-password').decode())[0] == 401
assert req('/',auth=False)[0] == 401
assert req('/api/forms',auth=True)[0] == 200
# The visual editor exposes GPS and camera/image answer types in its select menu.
frontend=__import__('pathlib').Path(__file__).resolve().parents[1].joinpath('app/static/app.js').read_text(encoding='utf-8')
assert "['geopoint','Géolocalisation GPS']" in frontend
assert "['image','Photo / Appareil photo']" in frontend
html=__import__('pathlib').Path(__file__).resolve().parents[1].joinpath('app/static/index.html').read_text(encoding='utf-8')
assert 'id="globalSearch"' in html and 'class="cp-quick-actions"' in html
assert json.loads(req('/api/forms')[1]) == []
root_request=urllib.request.Request(BASE+'/',headers={'Authorization':AUTH})
with urllib.request.urlopen(root_request) as root_response:
    assert root_response.status==200
    assert root_response.headers.get('Content-Security-Policy')
    assert root_response.headers.get('X-Content-Type-Options')=='nosniff'
# Schema validation prevents duplicate fields and disallowed types.
bad={'title':'Test form','short_title':'Test','description':'','sections':[{'title':'Sec','questions':[{'name':'q1','label':'Question 1','type':'text'},{'name':'q1','label':'Question 2','type':'text'}]}]}
assert req('/api/forms','POST',bad)[0] == 400
schema={'title':'Survey security test','short_title':'Security','description':'','sections':[{'title':'Terrain','questions':[{'name':'person_name','label':'Nom','type':'text','required':True},{'name':'gps_point','label':'GPS','type':'geopoint','required':True},{'name':'site_photo','label':'Photo','type':'image','required':False},{'name':'choice','label':'Choix','type':'select','options':['A','B'],'required':False}]}]}
status,raw=req('/api/forms','POST',schema); assert status==200,(status,raw)
form=json.loads(raw); fid=form['id']
status,raw=req(f'/api/forms/{fid}/share','POST',{}); assert status==200,(status,raw)
share=json.loads(raw); token=share['token']
assert req(f'/api/public/{token}/form',auth=False)[0]==200
qr_status, qr_bytes = req(f'/api/forms/{fid}/share/{token}/qr.png')
assert qr_status == 200 and qr_bytes.startswith(b'\x89PNG\r\n\x1a\n'), (qr_status, qr_bytes[:20])
# Required fields, GPS bounds, option membership and unknown field are validated server-side.
assert req(f'/api/public/{token}/submissions','POST',{'data':{'person_name':'Berly'}} ,auth=False)[0]==422
assert req(f'/api/public/{token}/submissions','POST',{'data':{'person_name':'B','gps_point':{'latitude':99,'longitude':15,'accuracy':10}}},auth=False)[0]==422
assert req(f'/api/public/{token}/submissions','POST',{'data':{'person_name':'B','gps_point':{'latitude':-4.3,'longitude':15.3,'accuracy':5},'choice':'X'}},auth=False)[0]==422
# Known valid sample image (tiny JPEG header bytes) plus valid coordinates.\n# Ensure the validator confirms signature, bounded size, and expected fields.
image_buffer=io.BytesIO()
Image.new('RGB',(2,2),(40,120,90)).save(image_buffer,format='JPEG')
image='data:image/jpeg;base64,'+base64.b64encode(image_buffer.getvalue()).decode()
valid={'data':{'person_name':'Berly','gps_point':{'latitude':-4.3,'longitude':15.3,'accuracy':5},'site_photo':image,'choice':'A'}}
status,raw=req(f'/api/public/{token}/submissions','POST',valid,auth=False); assert status==200,(status,raw)
# CSV export neutralizes spreadsheet formulas in user-provided strings.
formula_data={'data':{'person_name':'=1+1','gps_point':{'latitude':-4.3,'longitude':15.3,'accuracy':5},'choice':'A'}}
assert req(f'/api/public/{token}/submissions','POST',formula_data,auth=False)[0]==200
export_status, export_bytes=req('/api/export/csv')
assert export_status==200 and b"'=1+1" in export_bytes, export_bytes[:300]
xlsx_status,xlsx_export=req('/api/export/xlsx')
assert xlsx_status==200
from openpyxl import load_workbook
export_wb=load_workbook(io.BytesIO(xlsx_export),data_only=False)
export_ws=export_wb.active
headers=[c.value for c in export_ws[1]]
formula_col=headers.index('person_name')+1
assert any(export_ws.cell(row,formula_col).value=="'=1+1" for row in range(2,export_ws.max_row+1))
# Admin export endpoint must remain protected.
assert req('/api/export/csv',auth=False)[0]==401
# Anonymous public submissions are throttled after a per-IP fixed-window threshold.
rate_status=200
for _ in range(20):
    rate_status,_=req(f'/api/public/{token}/submissions','POST',{'data':{'person_name':'R','gps_point':{'latitude':-4.3,'longitude':15.3,'accuracy':5}}},auth=False)
    if rate_status==429: break
assert rate_status==429, f'Rate limit did not trigger, last status={rate_status}'
# XLSForm import keeps native GPS and photo types in the editor schema.
wb=Workbook(); ws=wb.active; ws.title='survey'
ws.append(['type','name','label','required'])
ws.append(['text','respondent','Nom','yes']); ws.append(['geopoint','geo','GPS','yes']); ws.append(['image','photo','Photo','no'])
xlsx=io.BytesIO(); wb.save(xlsx); xlsx_bytes=xlsx.getvalue()
boundary='CollectPlusTestBoundary'; body=(b'--'+boundary.encode()+b'\r\nContent-Disposition: form-data; name="file"; filename="survey.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'+xlsx_bytes+b'\r\n--'+boundary.encode()+b'--\r\n')
request=urllib.request.Request(BASE+'/api/forms/import',data=body,headers={'Authorization':AUTH,'Content-Type':'multipart/form-data; boundary='+boundary},method='POST')
with urllib.request.urlopen(request) as response: imported=json.loads(response.read())
imported_types=[q['type'] for sec in imported['sections'] for q in sec['questions']]
assert imported_types==['text','geopoint','image'], imported_types
# Upload size cap returns 413 before parsing a too-large workbook.
large_payload=b'0'*(5*1024*1024+1)
boundary2='CollectPlusLargeBoundary'; large_body=(b'--'+boundary2.encode()+b'\r\nContent-Disposition: form-data; name="file"; filename="oversized.xlsx"\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n'+large_payload+b'\r\n--'+boundary2.encode()+b'--\r\n')
large_req=urllib.request.Request(BASE+'/api/forms/import',data=large_body,headers={'Authorization':AUTH,'Content-Type':'multipart/form-data; boundary='+boundary2},method='POST')
try:
    urllib.request.urlopen(large_req)
    raise AssertionError('Oversized upload was accepted')
except urllib.error.HTTPError as error:
    assert error.code==413, error.code
# A form with no submissions can be deleted safely even when share tokens exist.
delete_schema={'title':'Temporary form','short_title':'Temp','description':'','sections':[{'title':'S','questions':[{'name':'temporary_field','label':'Temporary','type':'text','required':False}]}]}
status,delete_raw=req('/api/forms','POST',delete_schema); assert status==200
delete_form_id=json.loads(delete_raw)['id']
status,delete_share_raw=req(f'/api/forms/{delete_form_id}/share','POST',{}); assert status==200
delete_token=json.loads(delete_share_raw)['token']
assert req(f'/api/forms/{delete_form_id}','DELETE')[0]==200
assert req(f'/api/public/{delete_token}/form',auth=False)[0]==404
# Public link revocation disables further form access.
assert req(f'/api/forms/{fid}/share/revoke','POST',{})[0]==200
assert req(f'/api/public/{token}/form',auth=False)[0]==404
print('PASS: admin auth, security headers, editor GPS/photo option, schema and response validation, image decoding, XLSForm import, local QR, CSV/XLSX formula mitigation, upload size cap, throttling, form deletion and link revocation.')
