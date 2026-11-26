const express=require('express'),mysql=require('mysql2/promise'),path=require('path'),fs=require('fs'),os=require('os');
const cfg={host:process.env.DB_HOST||'127.0.0.1',user:process.env.DB_USER||'root',password:process.env.DB_PASS||''};
const PORT=process.env.PORT||3000;
const db=mysql.createPool({...cfg,database:'charger_caffe',decimalNumbers:true,connectionLimit:5});
const app=express();app.use(express.json({limit:'10mb'}));app.use(express.static(path.join(__dirname,'public')));
app.get('/api/info',(req,res)=>{const urls=[];Object.values(os.networkInterfaces()).flat().filter(n=>n.family=='IPv4'&&!n.internal).forEach(n=>urls.push('http://'+n.address+':'+PORT));res.json({urls})});
app.get('/api/state',async(req,res)=>{try{
  const q=t=>db.query(t).then(r=>r[0]);
  const[ad,cu,pr,inv,rc,sl,si]=await Promise.all([q('SELECT * FROM admins ORDER BY id'),q('SELECT * FROM customers ORDER BY id'),q('SELECT * FROM products ORDER BY id'),q('SELECT * FROM inventory ORDER BY id'),q('SELECT * FROM recipes'),q('SELECT * FROM sales ORDER BY ts,id'),q('SELECT * FROM sale_items ORDER BY id')]);
  if(!pr.length&&!ad.length)return res.json({});
  const rec={},it={};
  rc.forEach(r=>(rec[r.product_id]=rec[r.product_id]||[]).push({i:r.inventory_id,q:r.amount}));
  si.forEach(r=>(it[r.sale_id]=it[r.sale_id]||[]).push({n:r.name,q:r.qty,p:r.price}));
  res.json({v2:1,
    admins:ad.map(a=>({n:a.name,u:a.username,p:a.password})),
    cust:cu.map(a=>({n:a.name,u:a.username,p:a.password})),
    P:pr.map(p=>({id:p.id,name:p.name,cat:p.category,price:p.price,on:!!p.available,rec:rec[p.id]||[]})),
    inv:inv.map(i=>({id:i.id,name:i.name,cat:i.category,unit:i.unit,stock:i.stock,re:i.reorder})),
    sales:sl.map(s=>{const o={ts:s.ts,lines:it[s.id]||[],total:s.total};if(s.customer)o.cust=s.customer;if(s.status)o.st=s.status;return o})});
}catch(e){console.error(e);res.status(500).json({error:e.message})}});
app.put('/api/state',async(req,res)=>{const S=req.body||{},c=await db.getConnection();try{
  await c.beginTransaction();
  for(const t of ['sale_items','sales','recipes','products','inventory','customers','admins'])await c.query('DELETE FROM '+t);
  for(const a of S.admins||[])await c.query('INSERT INTO admins(name,username,password) VALUES(?,?,?)',[a.n,a.u,a.p]);
  for(const a of S.cust||[])await c.query('INSERT INTO customers(name,username,password) VALUES(?,?,?)',[a.n,a.u,a.p]);
  for(const i of S.inv||[])await c.query('INSERT INTO inventory VALUES(?,?,?,?,?,?)',[i.id,i.name,i.cat,i.unit,i.stock,i.re]);
  const ids=new Set((S.inv||[]).map(i=>i.id));
  for(const p of S.P||[]){await c.query('INSERT INTO products VALUES(?,?,?,?,?)',[p.id,p.name,p.cat,p.price,p.on?1:0]);
    for(const r of p.rec||[])if(ids.has(r.i))await c.query('INSERT IGNORE INTO recipes VALUES(?,?,?)',[p.id,r.i,r.q])}
  for(const s of S.sales||[]){const[r]=await c.query('INSERT INTO sales(ts,customer,status,total) VALUES(?,?,?,?)',[Math.round(s.ts),s.cust||null,s.st||null,s.total]);
    for(const l of s.lines||[])await c.query('INSERT INTO sale_items(sale_id,name,qty,price) VALUES(?,?,?,?)',[r.insertId,l.n,l.q,l.p])}
  await c.commit();res.json({ok:true});
}catch(e){await c.rollback();console.error(e);res.status(500).json({error:e.message})}finally{c.release()}});
(async()=>{
  const c=await mysql.createConnection({...cfg,multipleStatements:true});
  await c.query(fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8'));await c.end();
  app.listen(PORT,'0.0.0.0',()=>{console.log('Charger Caffe running');console.log('This laptop:  http://localhost:'+PORT);
    Object.values(os.networkInterfaces()).flat().filter(n=>n.family=='IPv4'&&!n.internal).forEach(n=>console.log('Other devices (same WiFi): http://'+n.address+':'+PORT))});
})().catch(e=>{console.error('MySQL error: '+e.message);console.error('Check that MySQL is running and DB_USER / DB_PASS are right.');process.exit(1)});
