/* Laila's Lab 3D: a real-time 3D bedroom and avatar (three.js, physically based materials, soft shadows,
   ambient occlusion, bloom, filmic tone mapping). index.html loads this file on demand and falls back to the
   flat artwork if the device cannot run WebGL. The decorations she unlocks that are not modelled in 3D are
   drawn from the same artwork the flat room uses and stand in the scene as lit cut-outs. */
import * as THREE from 'three';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js';
import {UnrealBloomPass} from 'three/addons/postprocessing/UnrealBloomPass.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';

/* ---------- helpers ---------- */
const loadImg=svg=>new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg)});
async function svgCanvas(svg,w,h){const i=await loadImg(svg);const c=document.createElement('canvas');c.width=w;c.height=h;c.getContext('2d').drawImage(i,0,0,w,h);return c}
const texOf=(c,aniso)=>{const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=aniso||8;return t};
const col=h=>new THREE.Color(h);
const lerpHex=(a,b,k)=>col(a).lerp(col(b),k);
function rand(seed){let s=seed;return()=>(s=(s*16807)%2147483647)/2147483647}
export const webglOk=(()=>{try{const c=document.createElement('canvas');return !!(c.getContext('webgl2'))}catch(e){return false}})();

/* ---------- materials ---------- */
const M={
  skin:c=>new THREE.MeshPhysicalMaterial({color:col(c),roughness:.52,sheen:.6,sheenColor:col('#ffb59a'),sheenRoughness:.45}),
  cloth:(c,r)=>new THREE.MeshPhysicalMaterial({color:col(c),roughness:r==null?.82:r,sheen:.7,sheenColor:col('#ffffff'),sheenRoughness:.6}),
  hair:c=>new THREE.MeshPhysicalMaterial({color:col(c),roughness:.42,sheen:1,sheenColor:lerpHex(c,'#ffffff',.5),sheenRoughness:.35,clearcoat:.25,clearcoatRoughness:.4}),
  wood:(c,r)=>new THREE.MeshPhysicalMaterial({color:col(c),roughness:r==null?.5:r,clearcoat:.35,clearcoatRoughness:.35}),
  paint:(c,r)=>new THREE.MeshStandardMaterial({color:col(c),roughness:r==null?.62:r}),
  gold:()=>new THREE.MeshStandardMaterial({color:col('#E3B94F'),metalness:1,roughness:.28}),
};

/* ---------- the camera, matched to the flat room so every decoration lines up ----------
   World units are meters; one flat-room unit is a centimeter. The camera looks straight ahead and the picture is shifted
   up (a lens shift, like an architect's camera), so vertical lines stay vertical. */
const FOV=28,CAMZ=6.62,HC=1.15,XC=1.78,ASP=604/330,WALLH=2.06;
const TAN=Math.tan(FOV*Math.PI/360),P11=1/TAN,P00=P11/ASP,SHIFT=1-(WALLH-HC)/(CAMZ*TAN);
const sx=x=>((x+124)/604)*2-1,sy=y=>1-(y/330)*2;
const planePt=(x,y,z)=>{const d=CAMZ-z;return new THREE.Vector3(XC+sx(x)*d/P00,HC+(sy(y)-SHIFT)*d/P11,z)};
const floorZ=y=>CAMZ+HC*P11/(sy(y)-SHIFT);
const X2=x=>planePt(x,0,0).x;           /* world x of a flat-room x at the wall */

/* ---------- procedural textures ---------- */
function floorTexture(){
  const W=1024,H=1024,c=document.createElement('canvas');c.width=W;c.height=H;const x=c.getContext('2d'),r=rand(11);
  const rows=8,rh=H/rows;
  for(let i=0;i<rows;i++){
    let px=-r()*300;
    while(px<W){
      const len=300+r()*380,t=.5+r()*.5,base=`hsl(${28+r()*5},${46+r()*10}%,${52+t*10}%)`;
      x.fillStyle=base;x.fillRect(px,i*rh,len,rh);
      for(let k=0;k<26;k++){x.strokeStyle=`rgba(${90+r()*30|0},${55+r()*20|0},30,${.05+r()*.1})`;x.lineWidth=1+r()*1.5;const yy=i*rh+r()*rh;x.beginPath();x.moveTo(px,yy);x.bezierCurveTo(px+len*.3,yy+(r()-.5)*6,px+len*.6,yy+(r()-.5)*6,px+len,yy+(r()-.5)*4);x.stroke()}
      x.fillStyle='rgba(60,32,16,.55)';x.fillRect(px,i*rh,len,2);x.fillRect(px+len-2,i*rh,2,rh);
      px+=len;
    }
    x.fillStyle='rgba(60,32,16,.5)';x.fillRect(0,i*rh,W,2);
  }
  const t=texOf(c,16);t.wrapS=t.wrapT=THREE.RepeatWrapping;return t;
}
function glowTexture(){
  const c=document.createElement('canvas');c.width=c.height=256;const x=c.getContext('2d');
  x.fillStyle='#000';x.fillRect(0,0,256,256);
  const g=x.createLinearGradient(0,0,0,256);g.addColorStop(0,'#fff');g.addColorStop(1,'#fff');
  x.filter='blur(14px)';x.fillStyle=g;x.fillRect(58,40,140,176);
  const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;return t;
}

/* ---------- the avatar ----------
   Built in the units of the flat avatar artwork (a figure 204 units tall, centre line x = 60) so the face, chest and accessory
   art lines up exactly. A unit is scaled to meters by the caller. */
const L=(x,y)=>[x-60,196-y];
function limb(a,b,r,mat){
  const A=new THREE.Vector3(a[0],a[1],a[2]||0),B=new THREE.Vector3(b[0],b[1],b[2]||0),len=A.distanceTo(B);
  const g=new THREE.CapsuleGeometry(r,Math.max(.1,len-2*r),6,16),m=new THREE.Mesh(g,mat);
  m.position.copy(A).add(B).multiplyScalar(.5);m.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),B.clone().sub(A).normalize());
  m.castShadow=true;return m;
}
function ball(x,y,z,r,mat,sc){const m=new THREE.Mesh(new THREE.SphereGeometry(r,20,16),mat);m.position.set(x,y,z);if(sc)m.scale.set(...sc);m.castShadow=true;return m}
/* a patch of artwork on a curved surface: vx/vy give the visible rectangle in avatar units, zf(x,y) the surface depth there */
function decalPatch(vx1,vy1,vx2,vy2,zf,map,nx,ny){
  const g=new THREE.PlaneGeometry(vx2-vx1,vy2-vy1,nx,ny),p=g.attributes.position;
  for(let i=0;i<p.count;i++){
    const u=p.getX(i)/(vx2-vx1)+.5,v=p.getY(i)/(vy2-vy1)+.5,ax=vx1+u*(vx2-vx1),ay=vy2-v*(vy2-vy1);
    const [lx,ly]=L(ax,ay);p.setXYZ(i,lx,ly,zf(ax,ay));
  }
  g.computeVertexNormals();
  const m=new THREE.Mesh(g,new THREE.MeshStandardMaterial({map,transparent:true,alphaTest:.03,roughness:.7,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2,depthWrite:true}));
  return m;
}
const CURL_STYLES={
  /* shell: [count, curl radius, how far up/back the shell reaches, scale], locks: corkscrews hanging down, extra: special parts */
  curly:{shell:[110,6.6,1.0,1.28],locks:[[34,52,52,3,3],[28,60,46,3,2.6]]},
  curls3a:{shell:[96,6.2,1.0,1.25],locks:[[35,50,56,3.4,2.1],[29,62,46,3,1.8]]},
  curls3b:{shell:[96,5.2,1.0,1.22],locks:[[36,48,66,3,4.6],[32,52,60,3,4.2],[28,56,54,3,3.8]]},
  coils3c:{shell:[170,5.4,1.0,1.42],locks:[]},
  curlpuffs:{shell:[44,5.4,.82,1.1],puffs:[[-36,31,13],[36,31,13]],locks:[[31,50,24,2.4,1.8]]},
  curlpony:{shell:[48,5.4,.72,1.08],puffs:[[0,22,18]],pony:1,locks:[[30,50,24,2.4,1.8]]},
  twistout:{shell:[96,6,1.0,1.25],locks:[[36,50,56,3,1.4],[30,58,50,3,1.3],[24,64,40,3,1.2]]},
  knots:{shell:[0,0,0,1],knots:1,locks:[]},
};
function hairGroup(spec,mat){
  const G=new THREE.Group(),r=rand(7),S=spec.style;
  const HX=60,HY=62,RX=28,RY=31,RZ=27;
  const cap=(s)=>{const m=ball(0,196-HY+1.5,-2.5,1,mat,[RX*s,RY*s*.98,RZ*s]);return m};
  const spiral=(cx,cy,cz,R,turns,dir)=>{ /* one corkscrew curl lying on the surface */
    const pts=[];for(let i=0;i<=24;i++){const t=i/24,a=t*turns*Math.PI*2,rr=R*(.2+.8*t);pts.push(new THREE.Vector3(cx+rr*Math.cos(a)*dir.x,cy+rr*Math.sin(a)*dir.y,cz+(1-t)*R*.5))}
    return pts};
  if(CURL_STYLES[S]){
    const C=CURL_STYLES[S];
    if(!C.knots){
      /* a solid base so no skin shows through, then curls on top */
      const base=cap(1.06);base.scale.z*=1.0;G.add(base);
      const [n,cr,reach,sc]=C.shell;
      for(let i=0;i<n;i++){
        const k=(i+.5)/n,phi=Math.acos(1-2*k)*reach+(1-reach)*0,th=i*2.399963;
        let x=Math.sin(phi)*Math.cos(th),y=Math.cos(phi),z=Math.sin(phi)*Math.sin(th);
        /* keep the face clear: skip the front-lower zone */
        if(z>.25&&y<.55)continue;
        if(z>.55&&y<.75)continue;
        const q=new THREE.Mesh(new THREE.IcosahedronGeometry(cr*(.8+r()*.45),1),mat);
        q.position.set(x*RX*sc*.93,196-HY+y*RY*sc*.95,z*RZ*sc*.93-(z>0?4:0));q.castShadow=true;G.add(q);
        const tor=new THREE.Mesh(new THREE.TorusGeometry(cr*.62,cr*.2,8,14),mat);tor.position.copy(q.position).multiplyScalar(1.02);tor.position.y+=0;tor.lookAt(tor.position.clone().multiplyScalar(2).add(new THREE.Vector3(0,196-HY,0).multiplyScalar(-1)));tor.rotation.z=r()*6;G.add(tor);
      }
    }
    (C.puffs||[]).forEach(([px,py,pr])=>{
      for(let i=0;i<22;i++){const th=i*2.399963,k=(i+.5)/22,ph=Math.acos(1-2*k);const q=new THREE.Mesh(new THREE.IcosahedronGeometry(pr*.34*(.8+r()*.4),1),mat);q.position.set(px+Math.sin(ph)*Math.cos(th)*pr*.82,196-py+Math.cos(ph)*pr*.82,Math.sin(ph)*Math.sin(th)*pr*.82-4);q.castShadow=true;G.add(q)}
      G.add(ball(px,196-py,-4,pr*.78,mat));
    });
    if(C.pony){
      for(let i=0;i<4;i++){
        const pts=[];for(let k=0;k<=30;k++){const t=k/30;pts.push(new THREE.Vector3(26+i*5-12+Math.sin(t*14+i)*3.4,196-30-t*62,-18+Math.cos(t*14+i)*3.4-i))}
        const tube=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),60,6.6-i*.5,10,false),mat);tube.castShadow=true;G.add(tube);
      }
    }
    if(C.knots){
      const pts=[[0,22],[-16,26],[16,26],[-28,36],[28,36],[-34,52],[34,52],[-22,34],[22,34],[0,34],[-10,28],[10,28]];
      G.add(cap(1.03));
      pts.forEach(([x,y],i)=>{const a=Math.atan2(y-48,x);const q=new THREE.Mesh(new THREE.SphereGeometry(6.8,16,12),mat);q.position.set(x,196-y,-6+(i>4?12:0));q.castShadow=true;G.add(q);
        const t=new THREE.Mesh(new THREE.TorusGeometry(3.6,.9,6,12),M.hair(spec.hair));t.position.copy(q.position);t.position.z+=5.5;G.add(t)});
    }
    (C.locks||[]).forEach(([lx,ly,len,amp,turns])=>{
      [-1,1].forEach(s=>{
        const pts=[],N=Math.round(turns*14);
        for(let i=0;i<=N;i++){const t=i/N;pts.push(new THREE.Vector3(s*(lx+amp*Math.sin(t*turns*Math.PI*2)*(1-.3*t)+t*3),196-ly-len*t,-3+amp*Math.cos(t*turns*Math.PI*2)*1.4-2))}
        const tube=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),N*3,4.4*(1-.3*0),10,false),mat);tube.castShadow=true;G.add(tube);
      });
    });
  }else if(S==='puffs'){
    G.add(cap(1.04));
    [-1,1].forEach(s=>{G.add(ball(s*38,196-32,-4,12,mat));for(let i=0;i<22;i++){const th=i*2.399963,k=(i+.5)/22,ph=Math.acos(1-2*k);const q=new THREE.Mesh(new THREE.IcosahedronGeometry(4.2*(.8+r()*.4),1),mat);q.position.set(s*38+Math.sin(ph)*Math.cos(th)*11,196-32+Math.cos(ph)*11,Math.sin(ph)*Math.sin(th)*11-4);q.castShadow=true;G.add(q)}});
  }else if(S==='braids'){
    G.add(cap(1.04));
    [-1,1].forEach(s=>{for(let i=0;i<7;i++){const t=i/6;const m=ball(s*(30-8*t),196-(66+54*t),-4-2*t,6.5,mat,[1,1.15,1]);G.add(m)}});
  }else if(S==='long'){
    G.add(cap(1.05));
    const back=new THREE.Mesh(new THREE.SphereGeometry(1,28,20),mat);back.scale.set(38,60,16);back.position.set(0,196-92,-12);back.castShadow=true;G.add(back);
  }else if(S==='pony'){
    G.add(cap(1.05));
    const pts=[];for(let k=0;k<=24;k++){const t=k/24;pts.push(new THREE.Vector3(26+t*16,196-48-t*52+Math.sin(t*3)*2,-16-t*4))}
    const tube=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),48,7,12,false),mat);tube.castShadow=true;G.add(tube);
    G.add(ball(24,196-48,-14,8,mat));
  }else if(S==='buns'){
    G.add(cap(1.05));
    [-1,1].forEach(s=>G.add(ball(s*32,196-26,-2,15,mat)));
  }else{G.add(cap(1.06))}
  return G;
}
/* the whole figure, standing with its feet on y = 0 */
async function buildAvatar(spec,opt){
  opt=opt||{};
  const G=new THREE.Group();
  const skinM=M.skin(spec.skin),topM=M.cloth(spec.ca),botM=M.cloth(spec.cb),hairM=M.hair(spec.hair);
  /* legs, socks, shoes */
  [49,71].forEach(x=>{
    const [lx]=L(x,0);
    G.add(limb([lx,196-160,0],[lx,196-184,0],5.2,skinM));
    G.add(limb([lx,196-180,0],[lx,196-191,0],5.8,M.cloth('#F7F4FB',.9)));
    const sh=new THREE.Mesh(new RoundedBoxGeometry(14,8,22,4,3),M.cloth('#FFFFFF',.55));sh.position.set(lx,196-193,5);sh.castShadow=true;G.add(sh);
    const so=new THREE.Mesh(new RoundedBoxGeometry(14.4,2.6,22.4,2,1.2),M.cloth('#D6CEE8',.9));so.position.set(lx,196-196.5,5);G.add(so);
  });
  /* skirt (or long hem for robes) and torso */
  const skirt=new THREE.Mesh(new THREE.CylinderGeometry(31,41,spec.long?44:32,40,1,false),topM);skirt.scale.z=.78;skirt.position.set(0,196-(spec.long?150:144),0);skirt.castShadow=true;G.add(skirt);
  const tor=new THREE.Mesh(new THREE.CylinderGeometry(20,29,38,32,1,false),topM);tor.scale.z=.68;tor.position.set(0,196-111,0);tor.castShadow=true;G.add(tor);
  const sh=new THREE.Mesh(new THREE.SphereGeometry(20.5,28,16,0,Math.PI*2,0,Math.PI/2),topM);sh.scale.set(1,.45,.68);sh.position.set(0,196-92,0);G.add(sh);
  const neck=new THREE.Mesh(new THREE.CylinderGeometry(6.6,7.4,10,16),skinM);neck.position.set(0,196-89,0);G.add(neck);
  /* arms */
  [-1,1].forEach(s=>{
    const sl=spec.long?132:119;
    G.add(limb([s*27,196-103,0],[s*34,196-135,2],4.8,skinM));
    G.add(limb([s*27,196-103,0],[s*33.4,196-sl,1],6.2,topM));
    G.add(ball(s*34,196-139.6,2.4,5.4,skinM));
    G.add(ball(s*28,196-103,0,7,topM));
  });
  /* head */
  const head=ball(0,196-62,0,1,skinM,[28,31,27]);G.add(head);
  [-1,1].forEach(s=>G.add(ball(s*27.6,196-64,-1,4.2,skinM,[1,1.3,.8])));
  /* face art, wrapped over the front of the head */
  if(opt.maps&&opt.maps.face){
    const zf=(x,y)=>{const a=(x-60)/28,b=(y-62)/31,q=1-a*a-b*b;return q>0?27*Math.sqrt(q)+.25:-5};
    G.add(decalPatch(32,31,88,93,zf,opt.maps.face,28,30));
  }
  G.add(hairGroup(spec,hairM));
  /* chest art (numbers, stripes, logos) */
  if(opt.maps&&opt.maps.top){
    const zf=(x,y)=>{const hw=20+9*Math.max(0,Math.min(1,(y-92)/38)),a=(x-60)/hw,q=1-a*a;return q>0?.68*hw*Math.sqrt(q)+.5:-4};
    G.add(decalPatch(27,91,93,131,zf,opt.maps.top,24,10));
  }
  /* accessories and held things from the artwork, standing just in front of the body */
  if(opt.maps&&opt.maps.acc){
    const m=new THREE.Mesh(new THREE.PlaneGeometry(120,204),new THREE.MeshStandardMaterial({map:opt.maps.acc,transparent:true,alphaTest:.03,roughness:.6,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));
    m.position.set(0,196-102,36);m.castShadow=false;G.add(m);
  }
  return G;
}
async function avatarMaps(spec){
  const k=2;
  const [face,top,acc]=await Promise.all([svgCanvas(spec.face(56*6,62*6),56*6,62*6),svgCanvas(spec.top(66*6,40*6),66*6,40*6),svgCanvas(spec.acc(120*4,204*4),120*4,204*4)]);
  return{face:texOf(face),top:texOf(top),acc:texOf(acc)};
}
function disposeTree(o){o.traverse(n=>{if(n.geometry)n.geometry.dispose();if(n.material){[].concat(n.material).forEach(m=>{['map','roughnessMap','normalMap','bumpMap'].forEach(k=>m[k]&&m[k].dispose());m.dispose()})}})}

/* ---------- a portrait of the avatar (home screen, avatar maker, tiny badges) ---------- */
let snap=null;
function snapRenderer(){
  if(snap)return snap;
  const canvas=document.createElement('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:true,preserveDrawingBuffer:true});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();
  const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(new RoomEnvironment(),.04).texture;scene.environmentIntensity=.55;
  const key=new THREE.DirectionalLight('#fff3e0',2.6);key.position.set(-120,300,260);key.castShadow=true;key.shadow.mapSize.set(1024,1024);
  Object.assign(key.shadow.camera,{left:-120,right:120,top:260,bottom:-20,near:10,far:900});key.shadow.bias=-.0006;key.shadow.normalBias=.6;scene.add(key);
  const rim=new THREE.DirectionalLight('#9fb6ff',1.6);rim.position.set(160,160,-220);scene.add(rim);
  const fill=new THREE.DirectionalLight('#ffd6e8',.5);fill.position.set(200,60,200);scene.add(fill);
  snap={renderer,scene,canvas,cache:new Map(),group:null};
  return snap;
}
/* vb = [x, y, w, h] in avatar units (the SVG viewBox being replaced); returns a canvas w x h */
export async function avatarPortrait(spec,vb,w,h){
  const key=JSON.stringify([spec.skin,spec.hair,spec.style,spec.ca,spec.cb,spec.long,vb,w,h,spec.face(1,1).length,spec.acc(1,1).length,spec.top(1,1).length]);
  const S=snapRenderer();
  if(S.cache.has(key))return S.cache.get(key);
  const maps=await avatarMaps(spec),g=await buildAvatar(spec,{maps});
  if(S.group){S.scene.remove(S.group);disposeTree(S.group)}
  S.group=g;S.scene.add(g);
  S.renderer.setPixelRatio(1);S.renderer.setSize(w,h,false);
  const [vx,vy,vw,vh]=vb,cx=vx+vw/2-60,cy=196-(vy+vh/2);
  const cam=new THREE.OrthographicCamera(-vw/2,vw/2,vh/2,-vh/2,10,2000);
  cam.position.set(cx+0,cy,600);cam.lookAt(cx,cy,0);
  S.renderer.render(S.scene,cam);
  const out=document.createElement('canvas');out.width=w;out.height=h;out.getContext('2d').drawImage(S.canvas,0,0);
  if(S.cache.size>30)S.cache.delete(S.cache.keys().next().value);
  S.cache.set(key,out);
  return out;
}

/* ---------- the room ---------- */
let R3=null;   /* the one renderer for the room, reused every time the Room screen is drawn */
function room3dRenderer(){
  if(R3)return R3;
  const canvas=document.createElement('canvas');canvas.className='room3d';
  const renderer=new THREE.WebGLRenderer({canvas,antialias:false,powerPreference:'high-performance'});
  renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.82;
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  const scene=new THREE.Scene();
  const pm=new THREE.PMREMGenerator(renderer);scene.environment=pm.fromScene(new RoomEnvironment(),.03).texture;scene.environmentIntensity=.42;
  const camera=new THREE.PerspectiveCamera(FOV,ASP,.1,60);camera.position.set(XC,HC,CAMZ);
  R3={canvas,renderer,scene,camera,content:null,composer:null,w:0,h:0,pick:[],parX:0,parY:0,raf:0,on:null};
  canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();R3.parX=((e.clientX-r.left)/r.width-.5);R3.parY=((e.clientY-r.top)/r.height-.5);req()});
  canvas.addEventListener('pointerleave',()=>{R3.parX=R3.parY=0;req()});
  canvas.addEventListener('click',e=>{
    const r=canvas.getBoundingClientRect(),v=new THREE.Vector2(((e.clientX-r.left)/r.width)*2-1,-((e.clientY-r.top)/r.height)*2+1);
    const rc=new THREE.Raycaster();rc.setFromCamera(v,R3.camera);
    const hits=rc.intersectObjects(R3.pick,false);
    for(const h of hits){
      const o=h.object;
      if(o.userData.layer){ /* cut-outs only count where there is something drawn */
        const uv=h.uv,cv=o.userData.layer,px=Math.min(cv.width-1,Math.max(0,Math.floor(uv.x*cv.width))),py=Math.min(cv.height-1,Math.max(0,Math.floor((1-uv.y)*cv.height)));
        let a=0;try{a=cv.getContext('2d').getImageData(px,py,1,1).data[3]}catch(er){a=255}
        if(a<24)continue;
      }
      if(o.userData.area&&R3.on){R3.on(o.userData.area);return}
    }
  });
  return R3;
}
function req(){if(!R3||R3.raf)return;R3.raf=requestAnimationFrame(()=>{R3.raf=0;draw()})}
function applyCamera(){
  const c=R3.camera;
  c.position.set(XC+R3.parX*.5,HC-R3.parY*.16,CAMZ);
  c.updateProjectionMatrix();c.projectionMatrix.elements[9]=-SHIFT;c.projectionMatrixInverse.copy(c.projectionMatrix).invert();
}
function draw(){
  if(!R3||!R3.canvas.isConnected||!R3.content)return;
  const box=R3.canvas.parentElement,w=Math.max(200,Math.round(box.clientWidth)),h=Math.round(w/ASP);
  if(w!==R3.w){
    R3.w=w;R3.h=h;const dpr=Math.min(2,window.devicePixelRatio||1);
    R3.renderer.setPixelRatio(dpr);R3.renderer.setSize(w,h,false);R3.canvas.style.width=w+'px';R3.canvas.style.height=h+'px';
    R3.camera.aspect=ASP;
    if(R3.composer){R3.composer.dispose&&R3.composer.dispose();R3.composer=null}
  }
  applyCamera();
  if(!R3.composer){
    const dpr=R3.renderer.getPixelRatio(),W=Math.round(w*dpr),H=Math.round(h*dpr);
    const rt=new THREE.WebGLRenderTarget(W,H,{type:THREE.HalfFloatType,samples:4});
    const comp=new EffectComposer(R3.renderer,rt);comp.setPixelRatio(dpr);comp.setSize(w,h);
    comp.addPass(new RenderPass(R3.scene,R3.camera));
    comp.addPass(new UnrealBloomPass(new THREE.Vector2(w,h),.16,.5,.96));
    comp.addPass(new OutputPass());
    R3.composer=comp;
  }
  R3.composer.render();
}

function softShadow(x,y,z,w,d,o){
  const c=document.createElement('canvas');c.width=c.height=128;const g=c.getContext('2d'),gr=g.createRadialGradient(64,64,4,64,64,62);
  gr.addColorStop(0,'rgba(40,20,50,.55)');gr.addColorStop(1,'rgba(40,20,50,0)');g.fillStyle=gr;g.fillRect(0,0,128,128);
  const m=new THREE.Mesh(new THREE.PlaneGeometry(w,d),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(c),transparent:true,depthWrite:false,opacity:o==null?1:o}));
  m.rotation.x=-Math.PI/2;m.position.set(x,y+.004,z);m.renderOrder=1;return m;
}

/* ---------- artwork with real depth ----------
   Each decoration the flat room draws becomes its own bevelled, lit relief (a height field grown from the shape's own outline), so it
   catches light, casts and receives shadows and shifts with the camera like the rest of the scene. The picture itself is the texture. */
function reliefLayer(canvas,cfg,pick){
  const W=604,H=330,cw=canvas.width,ch=canvas.height,fx=(cw/W)|0,fy=(ch/H)|0,out=new THREE.Group();
  const data=canvas.getContext('2d').getImageData(0,0,cw,ch).data;
  const N=W*H,mask=new Uint8Array(N);
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let a=0;for(let j=0;j<fy;j++)for(let i=0;i<fx;i++){const v=data[((y*fy+j)*cw+x*fx+i)*4+3];if(v>a)a=v}mask[y*W+x]=a>80?1:0}
  /* group touching shapes into one object (dilate, then flood fill) */
  const tmp=new Uint8Array(N),dil=new Uint8Array(N),RD=3;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(let k=-RD;k<=RD&&!v;k++){const xx=x+k;if(xx>=0&&xx<W&&mask[y*W+xx])v=1}tmp[y*W+x]=v}
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){let v=0;for(let k=-RD;k<=RD&&!v;k++){const yy=y+k;if(yy>=0&&yy<H&&tmp[yy*W+x])v=1}dil[y*W+x]=v}
  const lab=new Int32Array(N),comps=[],stack=[];
  for(let i=0;i<N;i++){
    if(!dil[i]||lab[i])continue;
    const id=comps.length+1,bb={x0:W,y0:H,x1:0,y1:0,n:0};comps.push(bb);lab[i]=id;stack.push(i);
    while(stack.length){
      const p=stack.pop(),px=p%W,py=(p/W)|0;
      if(mask[p]){bb.n++;if(px<bb.x0)bb.x0=px;if(py<bb.y0)bb.y0=py;if(px+1>bb.x1)bb.x1=px+1;if(py+1>bb.y1)bb.y1=py+1}
      if(px>0&&dil[p-1]&&!lab[p-1]){lab[p-1]=id;stack.push(p-1)}
      if(px<W-1&&dil[p+1]&&!lab[p+1]){lab[p+1]=id;stack.push(p+1)}
      if(py>0&&dil[p-W]&&!lab[p-W]){lab[p-W]=id;stack.push(p-W)}
      if(py<H-1&&dil[p+W]&&!lab[p+W]){lab[p+W]=id;stack.push(p+W)}
    }
  }
  /* distance to the outline */
  const D=new Float32Array(N);for(let i=0;i<N;i++)D[i]=mask[i]?1e4:0;
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){const i=y*W+x;if(!mask[i])continue;let d=D[i];
    if(x>0)d=Math.min(d,D[i-1]+1);
    if(y>0){d=Math.min(d,D[i-W]+1);if(x>0)d=Math.min(d,D[i-W-1]+1.414);if(x<W-1)d=Math.min(d,D[i-W+1]+1.414)}
    D[i]=d}
  for(let y=H-1;y>=0;y--)for(let x=W-1;x>=0;x--){const i=y*W+x;if(!mask[i])continue;let d=D[i];
    if(x<W-1)d=Math.min(d,D[i+1]+1);
    if(y<H-1){d=Math.min(d,D[i+W]+1);if(x<W-1)d=Math.min(d,D[i+W+1]+1.414);if(x>0)d=Math.min(d,D[i+W-1]+1.414)}
    D[i]=d}
  const tex=texOf(canvas,16);
  const mat=new THREE.MeshStandardMaterial({map:tex,roughness:cfg.rough==null?.6:cfg.rough,metalness:0,alphaTest:.42,emissive:0xffffff,emissiveMap:tex,emissiveIntensity:cfg.emi==null?.3:cfg.emi,envMapIntensity:.7});
  for(const bb of comps){
    if(bb.n<3)continue;
    const x0=Math.max(0,bb.x0-2),y0=Math.max(0,bb.y0-2),x1=Math.min(W,bb.x1+2),y1=Math.min(H,bb.y1+2),bw=x1-x0,bh=y1-y0;
    let stp=1;while((bw/stp)*(bh/stp)>16000)stp++;
    const nx=Math.ceil(bw/stp),ny=Math.ceil(bh/stp);
    let maxd=0;for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const d=D[y*W+x];if(mask[y*W+x]&&d>maxd)maxd=d}
    const Rr=Math.min(cfg.R,Math.max(1.6,(maxd-.5)*.95)),zi=cfg.zOf(bb),zc=zi.z,dy=zi.dy||0;
    const u=planePt(1,0,zc).x-planePt(0,0,zc).x,Hh=Rr*u*(cfg.k||.8);
    const at=(x,y)=>x<0||y<0||x>=W||y>=H||!mask[y*W+x]?0:Math.max(0,D[y*W+x]-.5);
    let hs=new Float32Array((nx+1)*(ny+1));
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
      const X=Math.min(x1,x0+i*stp),Y=Math.min(y1,y0+j*stp);
      const d=(at(X-1,Y-1)+at(X,Y-1)+at(X-1,Y)+at(X,Y))/4,t=Math.min(1,d/Rr);
      hs[j*(nx+1)+i]=Math.sqrt(1-(1-t)*(1-t));
    }
    const sm=new Float32Array(hs.length);
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){let s=0,c=0;for(let b=-1;b<=1;b++)for(let a=-1;a<=1;a++){const ii=i+a,jj=j+b;if(ii>=0&&jj>=0&&ii<=nx&&jj<=ny){s+=hs[jj*(nx+1)+ii];c++}}sm[j*(nx+1)+i]=s/c}
    hs=sm;
    const pos=new Float32Array((nx+1)*(ny+1)*3),uv=new Float32Array((nx+1)*(ny+1)*2),idx=[];
    for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
      const X=Math.min(x1,x0+i*stp),Y=Math.min(y1,y0+j*stp),k=j*(nx+1)+i,p=planePt(X-124,Y,zc+hs[k]*Hh);
      pos[k*3]=p.x;pos[k*3+1]=p.y+dy;pos[k*3+2]=p.z;uv[k*2]=X/604;uv[k*2+1]=1-Y/330;
    }
    for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
      let cov=0;const X=x0+i*stp,Y=y0+j*stp;
      for(let y=Y;y<Math.min(H,Y+stp)&&!cov;y++)for(let x=X;x<Math.min(W,X+stp);x++)if(mask[y*W+x]){cov=1;break}
      if(!cov)continue;
      const a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;idx.push(a,c,b,b,c,d);
    }
    if(!idx.length)continue;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(pos,3));g.setAttribute('uv',new THREE.BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();
    const m=new THREE.Mesh(g,mat);m.castShadow=cfg.cast!==false&&!!zi.cast;m.receiveShadow=true;m.userData={area:cfg.area,layer:canvas};
    out.add(m);pick.push(m);
    if(zi.blob){
      const wx=planePt((bb.x0+bb.x1)/2-124,0,zc).x,w=(bb.x1-bb.x0)*u*1.25;
      out.add(softShadow(wx,zi.top||0,zc,w,Math.max(.1,Math.min(.32,w*.5)),.8));
    }
  }
  return out;
}
/* a soft drop shadow for things that hang on the wall: the artwork's own outline, blurred, a little down and to the right */
function wallShadow(canvas,z,op){
  const s=document.createElement('canvas');s.width=302;s.height=165;const g=s.getContext('2d');
  g.drawImage(canvas,0,0,302,165);g.globalCompositeOperation='source-in';g.fillStyle='#2a1235';g.fillRect(0,0,302,165);
  const b=document.createElement('canvas');b.width=604;b.height=330;const h=b.getContext('2d');
  try{h.filter='blur(2.5px)'}catch(e){}
  h.drawImage(s,0,0,604,330);
  const bl=planePt(-124,330,z),tr=planePt(480,0,z),m=new THREE.Mesh(new THREE.PlaneGeometry(tr.x-bl.x,tr.y-bl.y),new THREE.MeshBasicMaterial({map:new THREE.CanvasTexture(b),transparent:true,opacity:op||.4,depthWrite:false}));
  m.position.set((bl.x+tr.x)/2+.022,(bl.y+tr.y)/2-.03,z);m.renderOrder=1;return m;
}

/* ---------- real models for the bigger things she can put on the floor ----------
   Built in flat-room units (1 unit = 1 cm at the wall) standing on y = 0, then scaled to fit where they stand. */
function canvasTex(w,h,draw,rep){
  const c=document.createElement('canvas');c.width=w;c.height=h;draw(c.getContext('2d'),w,h);
  const t=texOf(c,8);if(rep){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(rep[0],rep[1])}return t;
}
const wickerTex=()=>canvasTex(256,128,(g,w,h)=>{
  g.fillStyle='#C8955E';g.fillRect(0,0,w,h);
  for(let r=0;r<8;r++)for(let c=0;c<16;c++){const x=c*16,y=r*16,o=(r+c)%2;g.fillStyle=o?'#D7A76C':'#B5844F';g.fillRect(x+1,y+1,14,6);g.fillStyle=o?'#B5844F':'#D7A76C';g.fillRect(x+1,y+9,14,6);g.fillStyle='rgba(60,30,10,.35)';g.fillRect(x,y+7,16,2)}
},[3,1.4]);
const globeTex=()=>canvasTex(512,256,(g,w,h)=>{
  g.fillStyle='#3F94D8';g.fillRect(0,0,w,h);
  g.fillStyle='rgba(255,255,255,.18)';for(let y=32;y<h;y+=32)g.fillRect(0,y,w,1);for(let x=0;x<w;x+=43)g.fillRect(x,0,1,h);
  g.fillStyle='#7CCB8A';const r=rand(5);
  [[110,90,48,32],[150,150,26,40],[300,80,60,30],[330,150,34,44],[400,100,40,26],[440,170,26,14],[60,60,26,14],[255,40,30,10],[250,220,90,12]].forEach(([x,y,rx,ry])=>{g.beginPath();g.ellipse(x,y,rx,ry,r()-.5,0,Math.PI*2);g.fill()});
  g.fillStyle='#fff';g.fillRect(0,0,w,14);g.fillRect(0,h-16,w,16);
});
const ballTex=()=>canvasTex(512,256,(g,w,h)=>{
  g.fillStyle='#fff';g.fillRect(0,0,w,h);g.fillStyle='#22222c';
  [[0,.5],[.2,.5],[.4,.5],[.6,.5],[.8,.5],[.1,.12],[.3,.12],[.5,.12],[.7,.12],[.9,.12],[.1,.88],[.5,.88]].forEach(([u,v])=>{
    const cx=u*w,cy=v*h,rx=30/Math.max(.4,Math.sin(v*Math.PI)),ry=26;g.beginPath();for(let i=0;i<5;i++){const a=-Math.PI/2+i*Math.PI*2/5;g.lineTo(cx+Math.cos(a)*rx,cy+Math.sin(a)*ry)}g.closePath();g.fill()});
});
const netTex=()=>canvasTex(256,256,(g,w,h)=>{
  g.clearRect(0,0,w,h);g.strokeStyle='#14284B';g.lineWidth=5;
  for(let i=-8;i<16;i++){g.beginPath();g.moveTo(i*32,0);g.lineTo(i*32+h,h);g.stroke();g.beginPath();g.moveTo(i*32+h,0);g.lineTo(i*32,h);g.stroke()}
},[4,1.6]);
function starShape(r,ri){const s=new THREE.Shape();for(let i=0;i<10;i++){const a=-Math.PI/2+i*Math.PI/5,q=i%2?ri:r;i?s.lineTo(Math.cos(a)*q,Math.sin(a)*q):s.moveTo(Math.cos(a)*q,Math.sin(a)*q)}s.closePath();return s}
function soccerBall(r){const m=new THREE.Mesh(new THREE.SphereGeometry(r,40,28),new THREE.MeshPhysicalMaterial({map:ballTex(),roughness:.38,clearcoat:.5,clearcoatRoughness:.3}));m.position.y=r;return m}
function hamper(c,rimc){
  const g=new THREE.Group(),fm=M.cloth(c,.9);fm.side=THREE.DoubleSide;
  const body=new THREE.Mesh(new THREE.CylinderGeometry(16.5,15,40,40,1,true),fm);body.position.y=20;g.add(body);
  const bot=new THREE.Mesh(new THREE.CylinderGeometry(15,15,1.5,32),fm);bot.position.y=.8;g.add(bot);
  const rim=new THREE.Mesh(new THREE.TorusGeometry(16.5,2.6,10,40),M.cloth(rimc,.85));rim.rotation.x=Math.PI/2;rim.position.y=40;g.add(rim);
  const inn=new THREE.Mesh(new THREE.CylinderGeometry(15,15,1,32),M.paint('#5a3a5a',1));inn.position.y=34;g.add(inn);
  const cl=new THREE.Mesh(new THREE.SphereGeometry(11,20,14),M.cloth('#FFFFFF',.9));cl.scale.set(1.2,.6,1);cl.position.set(2,37,0);g.add(cl);
  return g;
}
const FLOOR3D={
  'bin:basket':(o)=>{
    const g=new THREE.Group(),wk=new THREE.MeshStandardMaterial({map:wickerTex(),roughness:.85,side:THREE.DoubleSide});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(19,15.5,40,40,1,true),wk);body.position.y=20;g.add(body);
    const bot=new THREE.Mesh(new THREE.CylinderGeometry(15.4,15.4,1.5,32),M.wood('#A8763F',.8));bot.position.y=.8;g.add(bot);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(19,1.7,10,40),M.wood('#B5844F',.7));rim.rotation.x=Math.PI/2;rim.position.y=40;g.add(rim);
    const rb=new THREE.Mesh(new THREE.TorusGeometry(15.6,1.5,10,40),M.wood('#A8763F',.7));rb.rotation.x=Math.PI/2;rb.position.y=3;g.add(rb);
    const cl=new THREE.Mesh(new THREE.SphereGeometry(14,24,16),M.cloth(o.accent||'#F29BBB',.9));cl.scale.set(1.15,.55,1);cl.position.y=40;g.add(cl);
    const cl2=new THREE.Mesh(new THREE.SphereGeometry(8,20,14),M.cloth('#FFFFFF',.9));cl2.scale.set(1.2,.6,.9);cl2.position.set(7,42,5);g.add(cl2);
    return g},
  'bin:hamperp':()=>hamper('#F29BBB','#EE86AA'),
  'bin:hamperstar':()=>{const g=hamper('#8E5CFF','#6B4FB5');
    const st=new THREE.Mesh(new THREE.ExtrudeGeometry(starShape(8,3.6),{depth:1.2,bevelEnabled:true,bevelThickness:.4,bevelSize:.4,bevelSegments:2}),M.gold());st.position.set(0,20,16);g.add(st);return g},
  'bin:net':()=>{
    const g=new THREE.Group();
    const nm=new THREE.MeshStandardMaterial({map:netTex(),transparent:true,alphaTest:.3,side:THREE.DoubleSide,roughness:.9});
    const body=new THREE.Mesh(new THREE.CylinderGeometry(18,14,40,32,1,true),nm);body.position.y=20;g.add(body);
    const rim=new THREE.Mesh(new THREE.TorusGeometry(18,1.4,8,36),M.cloth('#14284B',.7));rim.rotation.x=Math.PI/2;rim.position.y=40;g.add(rim);
    const bs=new THREE.Mesh(new THREE.CylinderGeometry(14,14,1.6,28),M.cloth('#14284B',.7));bs.position.y=.8;g.add(bs);
    const b=soccerBall(9);b.position.set(-3,10,0);g.add(b);const b2=soccerBall(9);b2.position.set(7,20,-2);g.add(b2);
    return g},
  globe:()=>{
    const g=new THREE.Group(),wd=M.wood('#6B3E1E',.5);
    const base=new THREE.Mesh(new THREE.CylinderGeometry(10,12,3.2,32),wd);base.position.y=1.6;g.add(base);
    const stem=new THREE.Mesh(new THREE.CylinderGeometry(1.5,1.9,22,12),wd);stem.position.y=14;g.add(stem);
    const sp=new THREE.Mesh(new THREE.SphereGeometry(16,48,32),new THREE.MeshPhysicalMaterial({map:globeTex(),roughness:.32,clearcoat:.7,clearcoatRoughness:.2}));sp.position.y=32;sp.rotation.z=-.4;sp.rotation.y=.6;g.add(sp);
    const ring=new THREE.Mesh(new THREE.TorusGeometry(18.6,1,10,64,Math.PI*1.1),M.gold());ring.position.y=32;ring.rotation.z=Math.PI/2+.4;g.add(ring);
    return g},
  bigplant:()=>{
    const g=new THREE.Group(),pot=new THREE.Mesh(new THREE.LatheGeometry([[0,0],[8,0],[8.6,1.5],[11.2,21],[12.4,21],[12.4,23.4],[11,23.4],[10.4,22],[0,22]].map(p=>new THREE.Vector2(p[0],p[1])),32),M.wood('#C8643A',.78));g.add(pot);
    const soil=new THREE.Mesh(new THREE.CylinderGeometry(10.6,10.6,1,24),M.paint('#4A2E1E',.95));soil.position.y=22.2;g.add(soil);
    const lm=new THREE.MeshPhysicalMaterial({color:col('#2E8A4F'),roughness:.45,sheen:.6,sheenColor:col('#9BE08A'),side:THREE.DoubleSide}),r=rand(3);
    for(let i=0;i<11;i++){
      const a=i*2.399963,tilt=.18+r()*.62,len=26+r()*20,lf=new THREE.Mesh(new THREE.SphereGeometry(1,16,10),lm);
      lf.scale.set(3.6+r()*1.6,len/2,.9);
      const pv=new THREE.Group();pv.position.y=22;pv.rotation.y=a;pv.rotation.z=tilt;lf.position.y=len/2;pv.add(lf);g.add(pv);
    }
    return g},
  ball:()=>{const g=new THREE.Group();g.add(soccerBall(9));return g},
  beanbag:(o)=>{
    const g=new THREE.Group(),geo=new THREE.SphereGeometry(1,48,32),p=geo.attributes.position;
    for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),k=1+.05*Math.sin(x*5+z*3)*Math.cos(y*4);p.setXYZ(i,x*k,Math.max(-.62,y*k),z*k)}
    geo.computeVertexNormals();
    const m=new THREE.Mesh(geo,M.cloth(o.accent||'#F29BBB',.92));m.scale.set(30,26,27);m.position.y=16.5;g.add(m);
    return g},
};
function placeFloor(model,x,yb,area){
  const z=Math.max(.05,floorZ(yb)),u=planePt(1,0,z).x-planePt(0,0,z).x,g=new THREE.Group();
  model.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true;n.userData.area=area}});
  g.add(model);g.scale.setScalar(u);g.position.set(planePt(x,0,z).x,0,z);g.userData.z=z;g.userData.u=u;return g;
}

export async function mountRoom(box,data,onArea){
  const S=room3dRenderer();
  S.on=onArea;
  if(S.canvas.parentElement!==box)box.appendChild(S.canvas);
  const token=(S.token=(S.token||0)+1);
  const {layers,meta,avatar}=data;
  const built=new THREE.Group();const pick=[];
  const wallM=M.paint(meta.wall,.9);

  /* shell: floor, walls, ceiling, baseboard */
  const ftex=floorTexture();ftex.repeat.set(5,2.6);
  const floor=new THREE.Mesh(new THREE.PlaneGeometry(14,10),new THREE.MeshPhysicalMaterial({map:ftex,roughness:.46,clearcoat:.5,clearcoatRoughness:.25}));
  floor.rotation.x=-Math.PI/2;floor.position.set(XC,0,3);floor.receiveShadow=true;floor.userData.area='floor';pick.push(floor);built.add(floor);
  const wall=new THREE.Mesh(new THREE.PlaneGeometry(14,3.4),wallM);wall.position.set(XC,1.7,0);wall.receiveShadow=true;wall.userData.area='walls';pick.push(wall);built.add(wall);
  const ceil=new THREE.Mesh(new THREE.PlaneGeometry(14,10),M.paint('#FFFFFF',.95));ceil.rotation.x=Math.PI/2;ceil.position.set(XC,3.4,3);built.add(ceil);
  const bb=new THREE.Mesh(new RoundedBoxGeometry(14,.1,.03,2,.01),M.paint('#FFFFFF',.5));bb.position.set(XC,.05,.016);bb.receiveShadow=true;built.add(bb);
  const crown=new THREE.Mesh(new RoundedBoxGeometry(14,.07,.03,2,.01),M.paint('#FFFFFF',.5));crown.position.set(XC,WALLH-.01,.016);built.add(crown);

  /* rug */
  if(layers.rug){
    const c=await svgCanvas(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-130 -100 260 200" width="1040" height="800">${layers.defs}<g>${layers.rug}</g></svg>`,1040,800);
    const t=texOf(c,16),zA=floorZ(254),zB=floorZ(308),zc=(zA+zB)/2,wd=2.6;
    const rug=new THREE.Mesh(new THREE.PlaneGeometry(wd,wd*200/260*1.0),new THREE.MeshStandardMaterial({map:t,transparent:true,alphaTest:.04,roughness:.95}));
    rug.rotation.x=-Math.PI/2;rug.position.set(X2(212),.006,zc);rug.scale.y=(zB-zA)/(wd*200/260)*1.25;rug.receiveShadow=true;rug.userData.area='rug';pick.push(rug);built.add(rug);
  }

  /* bed */
  {
    const zF=floorZ(258),x1=X2(116),x2=X2(308),bw=x2-x1,cx=(x1+x2)/2,fr=meta.frame;
    const frameM=M.wood(fr,.45);
    const mk=(g,mat,x,y,z)=>{const m=new THREE.Mesh(g,mat);m.position.set(x,y,z);m.castShadow=true;m.receiveShadow=true;m.userData.area='bed';pick.push(m);built.add(m);return m};
    const L0=zF-.04;
    mk(new RoundedBoxGeometry(bw,.07,L0,3,.025),frameM,cx,.17,.04+L0/2);
    [[-1,0],[1,0],[-1,1],[1,1]].forEach(([sx_,sz])=>mk(new RoundedBoxGeometry(.07,.17,.07,2,.02),frameM,cx+sx_*(bw/2-.05),.085,sz?zF-.06:.1));
    mk(new RoundedBoxGeometry(bw,.98,.09,4,.03),frameM,cx,.49+.0,.06);
    mk(new RoundedBoxGeometry(bw,.36,.07,4,.025),frameM,cx,.34,zF-.04);
    /* mattress, quilt and pillows */
    mk(new RoundedBoxGeometry(bw-.1,.2,L0-.14,6,.07),M.cloth('#F7F3FB',.9),cx,.31,.1+(L0-.14)/2);
    const sc=await svgCanvas(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 188 70" width="1128" height="420">${meta.sheet}</svg>`,1128,420);
    const st=texOf(sc,16);st.wrapS=st.wrapT=THREE.RepeatWrapping;
    const qLen=(L0-.14)*.7,qz=zF-.1-qLen/2;
    const qm=new THREE.MeshPhysicalMaterial({map:st,roughness:.88,sheen:1,sheenColor:col('#ffffff'),sheenRoughness:.6});
    const quilt=mk(new RoundedBoxGeometry(bw-.04,.07,qLen,6,.03),qm,cx,.46,qz);
    const fold=mk(new RoundedBoxGeometry(bw-.02,.08,.17,6,.035),M.cloth('#FFFFFF',.85),cx,.485,qz-qLen/2+.04);
    const pm=M.cloth('#FFFFFF',.8);
    [173,241].forEach(px=>mk(new RoundedBoxGeometry(.58,.17,.38,8,.07),pm,X2(px),.5,.34));
    built.add(softShadow(cx,0,zF/2+.05,bw+.5,zF+.3,.8));
  }
  /* dresser */
  {
    const zF=floorZ(216),x1=X2(8),x2=X2(104),w=x2-x1,top=planePt(0,152,zF).y,h=top,cx=(x1+x2)/2,dc=meta.dresC;
    const body=new THREE.Mesh(new RoundedBoxGeometry(w,h,zF,4,.025),M.wood(dc,.42));body.position.set(cx,h/2,zF/2);body.castShadow=body.receiveShadow=true;body.userData.area='dresser';pick.push(body);built.add(body);
    [[161,16],[180,15],[198,15]].forEach(([y,hh])=>{
      const yt=planePt(0,y,zF).y,yb=planePt(0,y+hh,zF).y;
      const dr=new THREE.Mesh(new RoundedBoxGeometry(w-.1,yt-yb-.015,.04,3,.012),M.wood(dc,.38));dr.position.set(cx,(yt+yb)/2,zF+.008);dr.castShadow=true;dr.userData.area='dresser';pick.push(dr);built.add(dr);
      const hd=new THREE.Mesh(new RoundedBoxGeometry(.16,.03,.03,3,.012),M.gold());hd.position.set(cx,(yt+yb)/2,zF+.04);dr.userData.area='dresser';hd.userData.area='dresser';built.add(hd);
    });
    [[-1],[1]].forEach(([s])=>{const l=new THREE.Mesh(new THREE.CylinderGeometry(.03,.025,.06,12),M.wood('#6B3E1E',.5));l.position.set(cx+s*(w/2-.06),.0,zF-.06);built.add(l)});
    built.add(softShadow(cx,0,zF/2+.05,w+.3,zF+.2,.7));
  }
  /* desk */
  {
    const zF=floorZ(214),x1=X2(338),x2=X2(476),w=x2-x1,cx=(x1+x2)/2,dkc=meta.deskC,ty=planePt(0,150,zF).y,td=Math.max(.5,zF*1.0);
    const dm=M.wood(dkc,.4);
    const slab=new THREE.Mesh(new RoundedBoxGeometry(w,.045,td,3,.015),dm);slab.position.set(cx,ty-.02,td/2);slab.castShadow=slab.receiveShadow=true;slab.userData.area='desk';pick.push(slab);built.add(slab);
    [[x1+.05,1],[x2-.05,1]].forEach(([lx])=>{[0.06,td-.06].forEach(lz=>{const l=new THREE.Mesh(new RoundedBoxGeometry(.05,ty-.04,.05,2,.012),dm);l.position.set(lx,(ty-.04)/2,lz);l.castShadow=true;l.userData.area='desk';pick.push(l);built.add(l)})});
    const du=new THREE.Mesh(new RoundedBoxGeometry(.5,.36,td-.06,3,.015),dm);du.position.set(x2-.32,ty-.2,td/2);du.castShadow=true;du.userData.area='desk';pick.push(du);built.add(du);
    [0,1].forEach(i=>{const f=new THREE.Mesh(new RoundedBoxGeometry(.44,.15,.02,2,.008),M.wood(dkc,.35));f.position.set(x2-.32,ty-.12-i*.16,td+.002);f.userData.area='desk';pick.push(f);built.add(f);const hh=new THREE.Mesh(new RoundedBoxGeometry(.14,.025,.02,2,.01),M.gold());hh.position.set(x2-.32,ty-.12-i*.16,td+.016);built.add(hh)});
    built.add(softShadow(cx,0,td/2+.05,w+.3,td+.2,.6));
  }

  /* shelves on the nook wall: real boards and brackets, so what stands on them has something to stand on */
  const shelfTop={};
  (meta.shelves||[]).forEach(sh=>{
    const zf=.3,top=planePt(0,sh.y,zf).y,x1=planePt(sh.x1,0,zf).x,x2=planePt(sh.x2,0,zf).x,w=x2-x1,cx=(x1+x2)/2,wd=M.wood('#B98A57',.55);
    shelfTop[sh.y]=top;
    const add=m=>{m.castShadow=m.receiveShadow=true;m.userData.area='nook';pick.push(m);built.add(m);return m};
    const bd=new THREE.Mesh(new RoundedBoxGeometry(w,.05,zf,3,.012),wd);bd.position.set(cx,top-.025,zf/2);add(bd);
    [x1+.09,x2-.09].forEach(bx=>{
      const pl=new THREE.Mesh(new RoundedBoxGeometry(.035,.2,.02,2,.006),wd);pl.position.set(bx,top-.15,.012);add(pl);
      const br=new THREE.Mesh(new RoundedBoxGeometry(.03,.29,.03,2,.008),wd);br.position.set(bx,top-.125,.14);br.rotation.x=1.012;add(br);
    });
  });

  /* fairy lights strung across the whole wall */
  if(layers.lights){
    const zw=.045,cols=['#FFD24D','#FF7BAF','#8FA6F0','#7CCB8A'],pts=[],bulbs=[];
    for(let k=0;k<5;k++){
      for(let i=0;i<=24;i++){const t=i/24,x=-130+k*124+t*124;pts.push(planePt(x,10+60*t*(1-t),zw))}
      for(let i=0;i<5;i++){const t=(i+.5)/5;bulbs.push([-130+k*124+t*124,10+60*t*(1-t)])}
    }
    const wire=new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts),260,.0035,6,false),M.paint('#6B5A3A',.7));wire.castShadow=true;built.add(wire);
    bulbs.forEach(([x,y],i)=>{
      const c=cols[i%4],p=planePt(x,y+4.5,zw+.012);
      const b=new THREE.Mesh(new THREE.SphereGeometry(.021,16,12),new THREE.MeshStandardMaterial({color:col(c),emissive:col(c),emissiveIntensity:2.6,roughness:.3}));b.position.copy(p);b.scale.y=1.2;b.userData.area='walls';pick.push(b);built.add(b);
      const cap=new THREE.Mesh(new THREE.CylinderGeometry(.008,.01,.016,8),M.paint('#6B5A3A',.6));cap.position.set(p.x,p.y+.026,p.z);built.add(cap);
      const gl=new THREE.PointLight(col(c),.05,.35,2);gl.position.copy(p);gl.position.z+=.08;built.add(gl);
    });
  }

  /* the nook rug */
  if(layers.rug2){
    const c=await svgCanvas(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-130 -100 260 200" width="1040" height="800">${layers.defs}<g>${layers.rug2}</g></svg>`,1040,800);
    const t=texOf(c,16),zA=floorZ(296),zB=floorZ(320),zc=(zA+zB)/2,z1=(floorZ(254)+floorZ(308))/2,wd=2.6*(.5/1.2)*((CAMZ-zc)/(CAMZ-z1));
    const rug=new THREE.Mesh(new THREE.PlaneGeometry(wd,wd*200/260),new THREE.MeshStandardMaterial({map:t,transparent:true,alphaTest:.04,roughness:.95}));
    rug.rotation.x=-Math.PI/2;rug.position.set(planePt(-62,0,zc).x,.006,zc);rug.scale.y=(zB-zA)/(wd*200/260)*1.25;rug.receiveShadow=true;rug.userData.area='nook';pick.push(rug);built.add(rug);
  }

  /* decorations drawn from the flat artwork become lit, bevelled relief with real depth and shadows */
  const wrapLayer=(inner,extra)=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-124 0 604 330" width="1208" height="660">${layers.defs}${inner}${extra||''}</svg>`;
  const onSurface=list=>bb=>{let b=list[0];for(const s of list)if(Math.abs(bb.y1-s.yb)<Math.abs(bb.y1-b.yb))b=s;return{z:b.z,dy:b.top-planePt(0,b.yb,b.z).y,top:b.top,blob:1,cast:1}};
  const zD=floorZ(216),zK=floorZ(214);
  const jobs=[
    {key:'wall',area:'walls',R:3,k:.9,emi:.3,zOf:()=>({z:.012}),shadow:.4},
    {key:'win',area:'window',R:5,k:.8,emi:.75,zOf:()=>({z:.016}),shadow:.3},
    {key:'nook',area:'nook',R:9,k:.85,emi:.3,zOf:onSurface((meta.shelves||[]).map(s=>({yb:s.y,z:.17,top:shelfTop[s.y]})))},
    {key:'dtop',area:'dresser',R:9,k:.85,emi:.3,zOf:onSurface([{yb:152,z:zD*.5,top:planePt(0,152,zD).y}])},
    {key:'desk',area:'desk',R:9,k:.85,emi:.3,zOf:onSurface([{yb:150,z:Math.max(.25,zK*.55),top:planePt(0,150,zK).y}])},
    {key:'flr',area:'floor',R:10,k:.85,emi:.3,zOf:bb=>{
      if(bb.y1<208)return{z:.05};
      /* anything drawn behind the bed (the telescope) stands on the floor in front of it instead of inside the mattress */
      const yb=bb.y1<258&&bb.x1>116+124&&bb.x0<300+124?268:bb.y1,z=Math.max(.05,floorZ(yb));return{z,dy:-planePt(0,yb,z).y,top:0,blob:1,cast:1};
    }},
    {key:'dec',area:'bed',R:8,k:.8,emi:.3,zOf:bb=>({z:.66,dy:.51-planePt(0,bb.y1,.66).y,top:.51,blob:0,cast:0})}
  ];
  for(const j of jobs){
    let inner=layers[j.key];if(!inner)continue;
    if(j.key==='dec')inner=`<g transform="translate(262 206)">${inner}</g>`;
    const c=await svgCanvas(wrapLayer(inner),1208,660);
    if(j.shadow)built.add(wallShadow(c,.004,j.shadow));
    built.add(reliefLayer(c,j,pick));
  }

  /* the larger floor things, as real models */
  for(const f of (layers.f3||[])){
    const mk=FLOOR3D[f.id];if(!mk)continue;
    const area=f.id.startsWith('bin:')&&f.x<0?'nook':'floor';
    const g=placeFloor(mk({accent:meta.accent}),f.x,f.y,area);
    g.traverse(n=>{if(n.isMesh)pick.push(n)});built.add(g);
    const u=g.userData.u;built.add(softShadow(g.position.x,0,g.position.z,46*u,34*u,.85));
  }

  /* Laila, standing where the flat room puts her */
  if(avatar){
    const maps=await avatarMaps(avatar),g=await buildAvatar(avatar,{maps});
    const zA=floorZ(291),hTop=planePt(350,164.5,zA).y,U=hTop/ (196-35);
    g.scale.setScalar(U);g.position.set(planePt(350,0,zA).x,0,zA);g.rotation.y=Math.atan2(XC-g.position.x,CAMZ-zA); /* face the camera, so her hair and accessories sit where the artwork puts them */
    g.traverse(o=>{if(o.isMesh){o.userData.area='closet';if(o.userData.area)pick.push(o)}});
    built.add(g);built.add(softShadow(g.position.x,0,zA,.55,.35,.9));
  }

  /* lights: sun through the window, a warm desk lamp, a soft fill */
  const sun=new THREE.SpotLight('#FFE3AE',26,14,.34,.9,1.3);
  sun.position.set(X2(202),1.35,-.6);sun.target.position.set(X2(190),0,2.8);
  sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.bias=-.0004;sun.shadow.normalBias=.03;sun.shadow.camera.near=.2;sun.shadow.camera.far=12;
  built.add(sun,sun.target);
  const lamp=new THREE.PointLight('#FFD9A0',2.2,3.2,2);lamp.position.set(X2(370),1.2,.35);built.add(lamp);
  const fill=new THREE.DirectionalLight('#EAF0FF',.38);fill.position.set(XC-2,3,6);built.add(fill);
  const hemi=new THREE.HemisphereLight('#FFF4F8','#B88A60',.32);built.add(hemi);

  if(token!==S.token){disposeTree(built);return}
  if(S.content){S.scene.remove(S.content);disposeTree(S.content)}
  S.content=built;S.pick=pick;S.scene.add(built);
  req();
}
export function unmountRoom(){if(R3&&R3.canvas.parentElement)R3.canvas.remove()}
/* put the room canvas into a freshly drawn box right away, so the screen does not flash while the scene is rebuilt */
export function attachRoom(box){
  if(!R3||!R3.content)return false;
  if(R3.canvas.parentElement!==box)box.appendChild(R3.canvas);
  R3.w=0;req();return true;
}
