import hashlib,hmac,json,os,time,uuid,urllib.parse,urllib.request
from decimal import Decimal
base='http://api:8000/api/v1'
token=None
def req(path,body=None):
    headers={'Content-Type':'application/json','Idempotency-Key':str(uuid.uuid4())}
    if token: headers['Authorization']='Bearer '+token
    data=json.dumps(body).encode() if body is not None else None
    with urllib.request.urlopen(urllib.request.Request(base+path,data=data,headers=headers),timeout=15) as r:
        return json.load(r)
fields={'auth_date':str(int(time.time())),'query_id':'isolated-smoke','user':json.dumps({'id':777000,'first_name':'Test'})}
secret=hmac.new(b'WebAppData',os.environ['BIRKA_TELEGRAM_BOT_TOKEN'].encode(),hashlib.sha256).digest()
fields['hash']=hmac.new(secret,'\n'.join(f'{k}={v}' for k,v in sorted(fields.items())).encode(),hashlib.sha256).hexdigest()
token=req('/auth/telegram',{'init_data':urllib.parse.urlencode(fields)})['access_token']
store=req('/me')['stores'][0]['id']
p=req('/catalog/products',{'store_id':store,'concept':'Docker smoke '+str(uuid.uuid4()),'variant':{'color':'чорний'},'sizes':[{'system':'ALPHA','code':'M'}]})
v=p['product_variant_id'];s=p['sizes'][0]['size_id']
r=req('/inventory/receipts',{'store_id':store,'lines':[{'product_variant_id':v,'size_id':s,'quantity':2,'unit_cost':'100.00'}]})
assert r['lines'][0]['quantity_after']==2
sale=req('/sales',{'store_id':store,'command_id':str(uuid.uuid4()),'lines':[{'product_variant_id':v,'size_id':s,'quantity':1,'unit_price':'300.00','discount_amount':'20.00'}]})
assert Decimal(sale['total'])==Decimal('280.00')
payload={'command_id':str(uuid.uuid4()),'lines':[{'sale_item_id':sale['items'][0]['id'],'quantity':1,'restock':True}],'reason':'isolated smoke'}
refund=req('/sales/'+sale['id']+'/refunds',payload)
replay=req('/sales/'+sale['id']+'/refunds',payload)
assert refund==replay
assert Decimal(refund['total_amount'])==Decimal('280.00')
stock=req('/inventory?store_id='+store)
assert next(row['quantity'] for row in stock['rows'] if row['product_variant_id']==v)==2
print('PASS real HTTP: Telegram signature auth -> product -> receipt -> sale -> refund -> durable replay; final stock=2, amount=280.00 UAH')
