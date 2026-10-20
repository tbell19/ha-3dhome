/* Builds a tiny fake Sweet Home 3D library (zip -> .sh3f -> catalog + OBJ/MTL/texture + a nested model zip)
 * at tools/mock/out/lib.zip, used by the smoke test in place of a real SourceForge download. */
const JSZip=require('jszip');const fs=require('fs');const zlib=require('zlib');const path=require('path');
// tiny solid png
function png(r,g,b,w=8,h=8){const raw=Buffer.alloc((w*3+1)*h);for(let y=0;y<h;y++){raw[y*(w*3+1)]=0;for(let x=0;x<w;x++){const o=y*(w*3+1)+1+x*3;raw[o]=r;raw[o+1]=g;raw[o+2]=b;}}
 const crc=(buf)=>{let c,t=[];for(let n=0;n<256;n++){c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0}let x=0xffffffff;for(const v of buf)x=t[(x^v)&255]^(x>>>8);return (x^0xffffffff)>>>0};
 const chunk=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(ty),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(w,0);ih.writeUInt32BE(h,4);ih[8]=8;ih[9]=2;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ih),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);}
// armchair-ish OBJ made of 3 boxes, units arbitrary (meters), Z-up to test modelRotation
function boxv(x0,x1,y0,y1,z0,z1,base){const v=[[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]];
 const f=[[1,2,3,4],[5,8,7,6],[1,5,6,2],[2,6,7,3],[3,7,8,4],[4,8,5,1]];return {v:v.map(p=>'v '+p.join(' ')).join('\n'),f:f.map(q=>'f '+q.map(i=>i+base).join(' ')).join('\n')}}
let obj='mtllib chair.mtl\n',base=0;const parts=[[0,0.8,0,0.8,0,0.4,'seat'],[0,0.8,0.65,0.8,0.4,0.9,'back'],[0,0.12,0,0.8,0.4,0.6,'arm'],[0.68,0.8,0,0.8,0.4,0.6,'arm']];
for(const [a,b,c,d,e,f,m] of parts){const r=boxv(a,b,c,d,e,f,base);obj+=r.v+'\nusemtl '+m+'\n'+r.f+'\n';base+=8;}
const mtl='newmtl seat\nKd 0.2 0.45 0.7\nmap_Kd fabric.png\nnewmtl back\nKd 0.15 0.35 0.6\nnewmtl arm\nKd 0.5 0.35 0.2\n';
async function build(){const s=new JSZip();
 s.file('PluginFurnitureCatalog.properties','# test\nid=Test\nname#1=Arm chair \\u00e9t\\u00e9\ncategory#1=Living room\nicon#1=/icons/chair.png\nmodel#1=/models/chair/chair.obj\nmultiPartModel#1=true\nwidth#1=80\ndepth#1=80\nheight#1=90\nmodelRotation#1=1 0 0 0 0 1 0 -1 0\ncreator#1=Tester\nname#2=Lamp\ncategory#2=Lights\nicon#2=/icons/lamp.png\nmodel#2=/models/lamp.zip\nwidth#2=30\ndepth#2=30\nheight#2=150\nelevation#2=0\n');
 s.file('icons/chair.png',png(60,120,200));s.file('icons/lamp.png',png(220,200,90));
 s.file('models/chair/chair.obj',obj);s.file('models/chair/chair.mtl',mtl);s.file('models/chair/fabric.png',png(90,140,210));
 const lz=new JSZip();lz.file('lamp/lamp.obj',boxv(-0.15,0.15,0,1.5,-0.15,0.15,0).v+'\n'+boxv(-0.15,0.15,0,1.5,-0.15,0.15,0).f);
 s.file('models/lamp.zip',await lz.generateAsync({type:'nodebuffer'}));
 const o=new JSZip();o.file('LucaPresidente-1.9.3.sh3f',await s.generateAsync({type:'nodebuffer'}));o.file('LICENSE.TXT','x');
 const out=path.join(__dirname,'out'); fs.mkdirSync(out,{recursive:true});
 const file=path.join(out,'lib.zip'); fs.writeFileSync(file,await o.generateAsync({type:'nodebuffer'}));
 fs.writeFileSync(path.join(out,'art_square.png'),png(200,60,120)); fs.writeFileSync(path.join(out,'art_wide.png'),png(30,90,70,32,18));
 return file;}
module.exports={build,png};
if(require.main===module) build().then(f=>console.log('wrote',f));
