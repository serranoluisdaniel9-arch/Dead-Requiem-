import * as THREE from './vendor/three.module.js';
import { decorateStreet } from './street-detail.js';
import { MISSION, ROUTES, ENEMY_TYPES, createMission, missionTarget, nearbyInteraction, applyInteraction, createEnemySpawns, routePickups } from './mission-rules.js';
import { createMissionWorld } from './mission-world.js';
import { DEFAULT_CONTROLS, loadControls, normalizeControls, saveControls } from './controls-settings.js';
import { ECONOMY_KEY, LEGACY_ECONOMY_KEY, WEAPONS, SKINS, EXTRACTION_REWARD, SUPPLIES_BONUS, defaultProfile, normalizeProfile, loadProfile, saveProfile, purchase, equip, beginRun, rewardExtraction, runStats, equipAttachmentOn, unequipAttachmentFrom } from './economy-rules.js';
import { ATTACHMENTS, attachmentsFor, resolveWeapon } from './attachments-rules.js';
import { createFallDirector, applyOutcome, buffActive, OUTCOME_TUNING, FALL_ZONES } from './falling-zombies.js';
import { createAudioEngine } from './audio-engine.js';
import { createFeedback, createBlobTexture } from './feedback.js';
import { createBlobShadowField } from './blob-shadows.js';
import { createStreetLighting, createDepthFog, surface } from './street-lighting.js';
import { createFogLayers, createDustField, createGrade, createLightingRig, QUALITY_PRESETS, resolveQuality } from './atmosphere.js';
import { decorateDestroyedCity } from './environment-detail.js';
import { texturedMaterial } from './procedural-textures.js';
import { mergeStaticGroup } from './geometry-merge.js';
import { zombiePose, resolveZombieState, weaponPose } from './zombie-animation.js';
import { createShop } from './shop-ui.js';
import { applyLook, aimDirection, aimCandidates, rayBox } from './aim-rules.js';
import { COMBAT, reloadDuration, tapBypassesCooldown, chooseShoveTarget, shoveEffect } from './combat-rules.js';
import { loadJoystick, normalizeJoystick, joystickLayout } from './joystick-settings.js';
import { createJoystickEditor } from './joystick-editor.js';
import { createCharacterFactory } from './character-models.js';
import { WAVES, ESCALATION, createWaveState, advanceWaves, planWaveSpawns } from './wave-rules.js';
// v1.4: graphics profiles with an Ultra tier and a real frame cap.
import { PROFILE_ORDER, FPS_OPTIONS, resolveProfile, resolveFps, createFrameLimiter, createFrameMeter } from './graphics-profiles.js';
// v1.4: zombie physics — the landing contract that fixes "walks while lying down".
import { impactOutcome, fallTime, landingState, rootTransform, locomotionFor, settleOnGround, separateFromColliders, insideCollider, groundHeightAt } from './zombie-physics.js';
// v1.4: perception, memory and ambush behaviour.
import { PERCEPTION, ROLES, visionConfidence, hearingConfidence, stepAlert, behaviourTarget, ambushTrigger, shareAlert, cowardMode } from './zombie-ai.js';
// v1.4: rain, wet surfaces and ambient smoke.
import { createRain, applyWetSurfaces, createSmokePlumes } from './weather.js';
// v1.4: per-part instancing, so 9 draws per archetype instead of 9 per zombie.
import { createZombieInstancer } from './zombie-instancing.js';

const $ = id => document.getElementById(id);
const canvas = $('game');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({canvas, antialias: devicePixelRatio < 2, powerPreference:'high-performance'});
} catch (e) {
  $('loading').textContent = 'No se pudo iniciar WebGL. Prueba Chrome con aceleración gráfica.';
  throw e;
}
const touch = true;
document.documentElement.classList.add('touch-device');
// v1.3: a real quality preset, not a label. It drives pixel ratio, shadow map
// resolution, fog layer count, dust count, texture size and debris density.
// v1.4: four tiers (Ultra added) and a separate frame cap, both persisted.
const QUALITY_KEY='distrito09.quality.v1';
const FPS_KEY='distrito09.fps.v1';
// A URL override (?quality=low|medium|high|ultra&fps=30|60|120) wins over the
// stored preference. It exists so the harness can render at a fixed preset on
// software GL, where a 2048 shadow map costs half a second per frame.
const params=new URLSearchParams(location.search);
const qualityOverride=params.get('quality');
const fpsOverride=params.get('fps');
let qualityId=resolveProfile(qualityOverride||(()=>{try{return localStorage.getItem(QUALITY_KEY);}catch(_){return null;}})(),{touch,devicePixelRatio});
let quality=QUALITY_PRESETS[qualityId];
let fpsCap=resolveFps(fpsOverride||(()=>{try{return localStorage.getItem(FPS_KEY);}catch(_){return null;}})(),{touch});
const frameLimiter=createFrameLimiter(fpsCap);
const frameMeter=createFrameMeter(90);
renderer.setPixelRatio(Math.min(devicePixelRatio, quality.pixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.45;
renderer.shadowMap.enabled = quality.shadows && !touch;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#8e9aa0');
// v1.2: linear fog with real depth instead of FogExp2 at .0385, which was
// already opaque at 40 m — the far city was drawn and then hidden.
// v1.3: colder, and pushed further out so the new facades are visible.
const depthFog = createDepthFog({ THREE, scene, color: '#8e9aa0', near: 30, far: 108 });
// The far plane now sits just past the fog's far distance: nothing beyond it
// can be seen, so nothing beyond it is drawn.
const camera = new THREE.PerspectiveCamera(58, innerWidth/innerHeight, .1, 116);
const clock = new THREE.Clock();
const V = THREE.Vector3;
let seed = 9042;
function rand(a=0,b=1) { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return a+(seed/4294967296)*(b-a); }
const clamp = THREE.MathUtils.clamp;
const mat = (color,extra={})=>new THREE.MeshStandardMaterial({color,roughness:.8,...extra});
// v1.2: each surface family gets its own roughness/metalness pair. v1.1 used
// .8 for nearly everything, so asphalt, steel and cloth all caught light the
// same way and the street read as one flat grey mass.
const M = {
  asphalt:surface(THREE,'asphalt','#283039'), pavement:surface(THREE,'pavement','#434c51'),
  concrete:surface(THREE,'concrete','#45515a'),
  trim:surface(THREE,'paintedSteel','#151d23'), line:surface(THREE,'concrete','#a69865'),
  steel:surface(THREE,'bareSteel','#36464c'),
  boots:surface(THREE,'rubber','#202322'),
  glow:mat('#ffba6d',{emissive:'#ff9232',emissiveIntensity:3}), cyan:mat('#7bdfdf',{emissive:'#409faa',emissiveIntensity:1.4})
};
const boxGeo = new THREE.BoxGeometry(1,1,1);
const obstacles=[];
function box(parent,w,h,d,x,y,z,material,shadow=true){
  const o=new THREE.Mesh(boxGeo,material);o.scale.set(w,h,d);o.position.set(x,y,z);
  o.castShadow=shadow;o.receiveShadow=true;parent.add(o);return o;
}
// v1.2: static street geometry is collected and flushed into one InstancedMesh
// per material. v1.1 emitted a separate Mesh for every building, lamp post,
// barricade and kerb — 458 BoxGeometry draw calls before a single character was
// drawn. Nothing here moves, so instancing is free.
const staticBatches=new Map();
function sbox(w,h,d,x,y,z,material,shadow=true){
  const key=`${material.uuid}/${shadow?1:0}`;
  if(!staticBatches.has(key))staticBatches.set(key,{material,shadow,items:[]});
  staticBatches.get(key).items.push([w,h,d,x,y,z,0,null]);
}
// v1.3: the same batch, but with a Y rotation and a per-instance tint. The four
// hero cars used to be ~40 separate meshes with a unique material each, because
// every body colour minted a new MeshStandardMaterial. Now they are instanced
// boxes sharing one material, tinted per instance.
function sboxT(w,h,d,x,y,z,material,shadow=true,ry=0,color=null){
  const key=`${material.uuid}/${shadow?1:0}`;
  if(!staticBatches.has(key))staticBatches.set(key,{material,shadow,items:[]});
  staticBatches.get(key).items.push([w,h,d,x,y,z,ry,color]);
}
// Cylinders (wheels, drums) need their own geometry, so they get their own map.
const cylinderGeo=new THREE.CylinderGeometry(1,1,1,10);
const cylinderBatches=new Map();
function scyl(r,h,x,y,z,material,shadow=true,rz=0,ry=0){
  const key=`${material.uuid}/${shadow?1:0}`;
  if(!cylinderBatches.has(key))cylinderBatches.set(key,{material,shadow,items:[]});
  cylinderBatches.get(key).items.push([r,h,x,y,z,rz,ry]);
}
function flushStaticBoxes(){
  const dummy=new THREE.Object3D();const tint=new THREE.Color();
  for(const {material,shadow,items} of staticBatches.values()){
    const mesh=new THREE.InstancedMesh(boxGeo,material,items.length);
    mesh.name='static-batch';
    mesh.castShadow=shadow;mesh.receiveShadow=true;
    const hasColor=items.some(item=>item[7]);
    items.forEach(([w,h,d,x,y,z,ry,color],i)=>{
      dummy.position.set(x,y,z);dummy.scale.set(w,h,d);dummy.rotation.set(0,ry,0);
      dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
      if(hasColor)mesh.setColorAt(i,tint.set(color||'#ffffff'));
    });
    mesh.instanceMatrix.needsUpdate=true;
    if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;
    scene.add(mesh);
  }
  for(const {material,shadow,items} of cylinderBatches.values()){
    const mesh=new THREE.InstancedMesh(cylinderGeo,material,items.length);
    mesh.name='static-cylinder-batch';
    mesh.castShadow=shadow;mesh.receiveShadow=true;
    items.forEach(([r,h,x,y,z,rz,ry],i)=>{
      dummy.position.set(x,y,z);dummy.scale.set(r,h,r);dummy.rotation.set(0,ry,rz);
      dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;
    scene.add(mesh);
  }
  staticBatches.clear();cylinderBatches.clear();
}
// v1.3: cinematic rig — cold moon key with shadows, warm street bounce, cold
// sky ambient and a rim light. The amber emergency lights are emissive meshes,
// so the scene still keeps exactly one PointLight (the recycled street lamp).
const lighting=createLightingRig({THREE,scene,quality:qualityId,touch});
const moon=lighting.moon;

// Every visual asset is generated here: no extracted game models or textures.
// v1.3: the road is a real procedural texture set (albedo + bump + roughness)
// instead of a flat colour with a noise map, so cracks and tar seams catch the
// moonlight at different angles.
M.asphalt.map=null;
// The material colour MULTIPLIES the albedo map. A dark tint over an already
// dark asphalt texture lands at ~0.03 albedo, which is why the road read as a
// flat black plane no matter how much detail the map carried. The tint is now
// near-white and the texture supplies the tone.
const asphaltSet=texturedMaterial(THREE,'asphalt',{repeat:6,bumpScale:.02,roughness:1,metalness:.05});
M.asphalt.color.set('#c8ccd0');
M.asphalt.map=asphaltSet.map;
M.asphalt.bumpMap=asphaltSet.bumpMap;
M.asphalt.bumpScale=asphaltSet.bumpScale;
M.asphalt.roughnessMap=asphaltSet.roughnessMap;
M.asphalt.needsUpdate=true;
// v1.3: the pavement and the kerb get their own concrete set, so the street is
// not one flat grey plane from kerb to kerb.
const pavementSet=texturedMaterial(THREE,'concrete',{repeat:8,bumpScale:.03,roughness:1});
M.pavement.color.set('#b9bcc0');
M.pavement.map=pavementSet.map;
M.pavement.bumpMap=pavementSet.bumpMap;
M.pavement.bumpScale=pavementSet.bumpScale;
M.pavement.roughnessMap=pavementSet.roughnessMap;
M.pavement.needsUpdate=true;
box(scene,160,.6,230,0,-.5,-10,mat('#1d262c'));
box(scene,19,.15,190,0,-.12,-10,M.asphalt);
// Hoisted: a `mat()` call inside a loop would mint a new material per instance
// and defeat the batching entirely.
const kerbMat=mat('#858b83'),tickMat=mat('#59636a'),crossMat=mat('#9b9f93'),binMat=mat('#344a47');
for(const side of [-1,1]){
  sbox(3,.24,190,side*10.4,-.03,-10,M.pavement);
  sbox(.2,.28,190,side*8.95,.02,-10,kerbMat);
  for(let i=0;i<24;i++)sbox(2.9,.012,.035,side*10.4,.101,-98+i*8,tickMat,false);
}
const stripe = new THREE.InstancedMesh(boxGeo,M.line,40);
const dummy=new THREE.Object3D();
for(let i=0;i<40;i++){dummy.position.set(0,-.027,-102+i*5);dummy.scale.set(.13,.015,2.1);dummy.updateMatrix();stripe.setMatrixAt(i,dummy.matrix);}scene.add(stripe);
// A crosswalk at the starting intersection.
for(let i=-4;i<=4;i++)sbox(1.1,.014,2.8,i*1.85,-.02,20,crossMat,false);
const windowMats=[mat('#8daba4',{emissive:'#518d87',emissiveIntensity:.12}),mat('#a99c7a',{emissive:'#b3945a',emissiveIntensity:.1}),mat('#3b4645')];
const windows=[[],[],[]];
// A fixed facade palette: one material per tone, so 30 buildings batch into 6
// instanced draws instead of 30 unique materials.
// v1.3: each tone now carries a real procedural surface — brick, plaster or
// concrete — with albedo, bump and roughness maps. The palette stays at six
// materials, so the batching is unchanged; only what they look like changed.
const facadeKinds=['brick','plaster','concrete','brick','plaster','concrete'];
const facadeMats=facadeKinds.map((kind,i)=>{
  const tone=[.44,.50,.56,.40,.53,.47][i];
  const m=texturedMaterial(THREE,kind,{repeat:2,bumpScale:.06,roughness:1,metalness:.02});
  // Same multiply trap as the road: a 0.44 grey over a 0.4 brick map is 0.18
  // albedo, which reads as a black wall. The tint is lifted so the map's own
  // brick courses and plaster patches survive the multiply.
  m.color.setHSL(.13,.05,Math.min(1,tone*1.85));
  return m;
});
for(const side of [-1,1])for(let i=0;i<15;i++){
  const z=-105+i*13, h=rand(10,29),w=rand(7,12),d=rand(10.7,12.5),x=side*(12+w/2);
  const bm=facadeMats[(i*2+(side>0?1:0))%facadeMats.length];
  sbox(w,h,d,x,h/2,z,bm);
  sbox(w+.3,.38,d+.25,x,h,z,M.trim);
  sbox(.35,h,.5,side*12.1,h/2,z-d/2+.2,M.concrete);
  sbox(.25,3,d-1,side*11.91,1.55,z,M.trim);
  for(let floor=0;floor<Math.floor((h-3)/3);floor++)for(let col=0;col<4;col++){
    const wz=z-d*.35+col*d*.235,wy=4.5+floor*3;
    const k=rand()<.32?Math.floor(rand(0,2)):2;windows[k].push([side*11.88,wy,wz]);
  }
  // Roof equipment and street-facing doorway.
  sbox(2.1,1.3,2.5,x,h+.65,z,M.steel);
  sbox(.1,2.6,1.8,side*11.75,1.35,z,M.steel);
}
windows.forEach((positions,k)=>{const mesh=new THREE.InstancedMesh(boxGeo,windowMats[k],positions.length);positions.forEach((p,i)=>{dummy.position.set(...p);dummy.scale.set(.08,1.45,1.4);dummy.updateMatrix();mesh.setMatrixAt(i,dummy.matrix);});scene.add(mesh);});

function sign(text,sub,color,x,z,side){
  const c=document.createElement('canvas');c.width=768;c.height=256;const ctx=c.getContext('2d');
  ctx.fillStyle='#142026';ctx.fillRect(0,0,768,256);ctx.strokeStyle=color;ctx.lineWidth=8;ctx.strokeRect(12,12,744,232);
  ctx.textAlign='center';ctx.fillStyle=color;ctx.font='bold 85px sans-serif';ctx.fillText(text,384,128);
  ctx.fillStyle='#c1c9c4';ctx.font='28px monospace';ctx.fillText(sub,384,190);
  const tex=new THREE.CanvasTexture(c);tex.colorSpace=THREE.SRGBColorSpace;
  const m=new THREE.MeshBasicMaterial({map:tex});const mesh=new THREE.Mesh(new THREE.PlaneGeometry(4.6,1.53),m);
  mesh.position.set(x,4,z);mesh.rotation.y=side<0?Math.PI/2:-Math.PI/2;scene.add(mesh);
}

sign('REFUGIO','NO QUEDAN PLAZAS','#e9b06d',11.7,-30,1);
sign('ÚLTIMA LUZ','SUMINISTROS · 24H','#d5b982',-11.7,37,-1);
const lampHeads=[];
for(let i=0;i<12;i++){
  const side=i%2?1:-1,z=-88+i*15,x=side*8.35;
  sbox(.13,6.2,.13,x,3.1,z,M.steel);
  sbox(1.25,.12,.14,x-side*.6,6.13,z,M.steel);
  sbox(.6,.08,.32,x-side*1.15,6.04,z,M.glow,false);
  // v1.2: the lamp head is recorded, not lit. One recycled PointLight follows
  // the player instead of eight static lights lighting the whole street.
  lampHeads.push({x:x-side*1.1,y:5.8,z});
  sbox(.32,.38,.32,x,.18,z,M.steel);
}
const streetLighting=createStreetLighting({THREE,scene,lamps:lampHeads});
// v1.3: cars are instanced. Each part is placed in the car's local frame and
// rotated into world space, so the whole fleet costs a handful of draws instead
// of ~40 meshes with a unique material per body colour.
const carBodyMat=surface(THREE,'paintedSteel','#ffffff');
const carGlassMat=mat('#233c43',{metalness:.8,roughness:.15});
const carHeadMat=mat('#d8d7ac',{emissive:'#b3a777',emissiveIntensity:.35});
const carTailMat=mat('#8c3330',{emissive:'#69241a',emissiveIntensity:.3});
function car(x,z,color,angle=0){
  const cos=Math.cos(angle),sin=Math.sin(angle);
  // Local (lx,lz) -> world, matching a Y rotation of `angle`.
  const at=(lx,lz)=>[x+lx*cos+lz*sin,z-lx*sin+lz*cos];
  const put=(w,h,d,lx,ly,lz,material,shadow=true,ry=angle,tint=null)=>{
    const [wx,wz]=at(lx,lz);sboxT(w,h,d,wx,ly,wz,material,shadow,ry,tint);
  };
  put(1.85,.65,3.7,0,.7,0,carBodyMat,true,angle,color);
  put(1.55,.7,1.9,0,1.3,-.2,carBodyMat,true,angle,color);
  put(1.57,.48,.04,0,1.4,.77,carGlassMat);
  put(1.57,.48,.04,0,1.4,-1.17,M.trim);
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const [wx,wz]=at(sx*.94,sz*1.15);
    scyl(.37,.2,wx,.39,wz,M.boots,true,Math.PI/2,angle);
  }
  put(1.5,.15,.08,0,.55,1.9,M.steel);
  for(const sx of [-1,1]){
    put(.38,.17,.07,sx*.58,.79,1.89,carHeadMat);
    put(.3,.16,.07,sx*.65,.84,-1.89,carTailMat);
  }
  obstacles.push({x,z,rx:1.2,rz:2.25});
}
car(-6,5,'#586d70',.12);car(6,-18,'#746c51',-.1);car(-6,-43,'#5c6664',.05);car(6,44,'#554345',-.08);
// Scattered barricades and waste containers on the sidewalk.
for(let i=0;i<13;i++){
  const side=i%2?1:-1,z=-85+i*13;
  sbox(.85,1.15,.85,side*10.5,.6,z,binMat);
  sbox(.95,.12,.95,side*10.5,1.2,z,M.trim);
  obstacles.push({x:side*10.5,z,rx:.48,rz:.48});
}
// Every static box recorded above becomes one instanced draw per material.
flushStaticBoxes();
decorateStreet({THREE,scene,materials:M,obstacles});
// v1.3: the destroyed-city layer — blown facades, wrecks, containers, fallen
// lamps, cables, rubble and road damage. Instanced by material, so the whole
// layer costs a handful of draws.
const destroyedCity=decorateDestroyedCity({THREE,scene,materials:M,obstacles,quality:quality.debris});
const missionWorld=createMissionWorld({THREE,scene,materials:M,mission:MISSION});
// v1.3: the mission props (five pickups, the clinic case, the extraction sign)
// were 55 separate meshes. They never move, so each group is merged into one
// mesh per material — 55 draws become about 12.
const missionMerge={before:0,after:0};
// `pickups` is a Map, not a plain object — Object.values() on it yields nothing,
// which is why the first pass only merged the clinic and the extraction sign.
const missionGroups=[missionWorld.markers.clinic,missionWorld.markers.extraction,
  ...(missionWorld.markers.pickups instanceof Map?missionWorld.markers.pickups.values():[])];
// v1.4: merge them as ONE group, not one group each. Merging per marker gave one
// draw per marker (28 draws) because each marker's meshes were keyed separately;
// collecting them under a single container lets the signature merge collapse
// them to one draw per kind of surface.
const missionMergeRoot=new THREE.Group();
missionMergeRoot.name='mission-merged';
scene.add(missionMergeRoot);
for(const marker of missionGroups){
  if(!marker||!marker.isObject3D)continue;
  missionMergeRoot.attach(marker);
}
{
  const result=mergeStaticGroup(THREE,missionMergeRoot,{bakeColor:true});
  missionMerge.before+=result.before;missionMerge.after+=result.after;
}
// v1.3: atmosphere — volumetric fog impression, floating dust and a colour
// grade drawn as a full-screen quad after the scene.
const fogLayers=createFogLayers({THREE,scene,count:quality.fogLayers,color:'#9aa8ac'});
const dustField=createDustField({THREE,scene,count:quality.dust,color:'#c6cfc9'});
const grade=createGrade({THREE,renderer,strength:quality.grade?1:0});
// v1.4: weather. v1.3 had `rainCount = 0` — the buffer existed and was never
// filled, so the rain in the README was a dead code path. It is real now, and
// its density comes from the graphics profile.
const rainField=createRain({THREE,scene,count:quality.rain,area:34,height:22});
// Wet surfaces: a material change, not a filter. A wet street is smoother, so
// the lamp light smears down it instead of sitting as a flat sheen.
const wetResult=applyWetSurfaces({materials:[M.asphalt,M.pavement],wet:quality.wet});
// Volumetric impression through drifting translucent road mist.
function radialTexture(){const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');const g=ctx.createRadialGradient(32,32,0,32,32,32);g.addColorStop(0,'rgba(255,255,255,.8)');g.addColorStop(.3,'rgba(255,255,255,.28)');g.addColorStop(1,'rgba(255,255,255,0)');ctx.fillStyle=g;ctx.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);}
const glowTexture=radialTexture();
// v1.4: ambient smoke rising from the wrecks. Cheap, and it is what sells
// "something burned here" — the street had no vertical motion at all before.
const smokePlumes=createSmokePlumes({THREE,scene,count:quality.smoke,texture:glowTexture,
  sources:[{x:-6,y:.5,z:5},{x:6,y:.5,z:-18},{x:-6,y:.5,z:-43},{x:6,y:.5,z:44},{x:0,y:.4,z:-70}]});
// v1.3: the old 12 drifting mist sprites are gone — createFogLayers() does the
// same job with 5-7 large sheets instead of 12 individual sprites, and it can
// fade with distance. `mist` stays as an empty list so the tick loop is unchanged.
const mist=[];
const rainCount=0;const rainPositions=new Float32Array(rainCount*6);
for(let i=0;i<rainCount;i++){const j=i*6,x=rand(-18,18),y=rand(0,20),z=rand(-35,35);rainPositions.set([x,y,z,x-.12,y-.65,z],j);}
const rainGeo=new THREE.BufferGeometry();rainGeo.setAttribute('position',new THREE.BufferAttribute(rainPositions,3));
const rain=new THREE.LineSegments(rainGeo,new THREE.LineBasicMaterial({color:'#a0bdc8',transparent:true,opacity:.16,depthWrite:false}));rain.visible=rainCount>0;scene.add(rain);

// Snapshot solid scenery before adding characters or weapon/effect models.
const shotBlockers=[];
scene.traverse(object=>{
  if(object.isMesh&&!Array.isArray(object.material)&&!object.material.transparent)shotBlockers.push(object);
});

const characterVisuals=createCharacterFactory({THREE});
// Blob shadows: a soft radial plane under every character. They are the only
// grounding cue on touch devices, where the shadow map is deliberately off.
const blobTexture=createBlobTexture(THREE);
// v1.2: one InstancedMesh for every blob shadow. v1.1 gave each character its
// own plane, so 37 characters cost 37 draw calls and 37 materials.
const blobField=createBlobShadowField({THREE,texture:blobTexture,capacity:96});
scene.add(blobField.mesh);
// v1.4: per-part instancing. The rig keeps its pivots and the pose solver keeps
// writing rotations; this layer mirrors each part's world matrix into one
// InstancedMesh per (archetype, part). 9 draws per archetype instead of 9 per
// zombie — with six archetypes on screen that is ~54 draws instead of 200+.
const zombieInstancer=createZombieInstancer({THREE,scene,capacity:48});
function groundCharacter(character){
  if(!character.shadow)return;
  const p=character.group.position;
  character.shadow.x=p.x;character.shadow.z=p.z;
  character.shadow.groundY=(Math.abs(p.x)>9?.095:-.04);
}
const feedback=createFeedback({container:$('app'),crosshair:$('crosshair')});
function human(zombie=false,variant=0,kind='shambler'){
  const body=characterVisuals.createBody(zombie,variant,kind);
  const {group,upper}=body;
  const shadow=blobField.add({width:zombie?.86:.8,depth:zombie?.6:.56,opacity:zombie?.46:.42});
  body.shadow=shadow;
  let gun,muzzle,gunModels,gunRig;
  if(!zombie){
    gunRig=new THREE.Group();gunRig.position.set(-.40,1.49-upper.position.y,0);upper.add(gunRig);
    gun=new THREE.Group();gun.position.set(0,0,.57);gunRig.add(gun);
    const pistol=new THREE.Group(),revolver=new THREE.Group(),smg=new THREE.Group(),shotgun=new THREE.Group(),rifle=new THREE.Group(),compact=new THREE.Group(),carbine=new THREE.Group(),marksman=new THREE.Group(),burst=new THREE.Group(),magnum=new THREE.Group(),pump=new THREE.Group(),lmg=new THREE.Group();
    gun.add(pistol,revolver,smg,shotgun,rifle,compact,carbine,marksman,burst,magnum,pump,lmg);gunModels={pistol,revolver,smg,shotgun,rifle,compact,carbine,marksman,burst,magnum,pump,lmg};
    box(pistol,.105,.125,.33,0,0,.13,M.steel);box(pistol,.09,.19,.115,0,-.11,.015,M.trim);box(pistol,.055,.055,.13,0,.0,.35,M.trim);box(pistol,.018,.025,.035,0,.08,.285,M.trim);
    box(revolver,.11,.15,.21,0,-.015,.1,M.steel);box(revolver,.105,.2,.12,0,-.12,-.015,M.trim);
    const drum=new THREE.Mesh(new THREE.CylinderGeometry(.082,.082,.18,8),M.steel);drum.rotation.x=Math.PI/2;drum.position.set(0,.02,.14);revolver.add(drum);
    const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.32,8),M.steel);barrel.rotation.x=Math.PI/2;barrel.position.set(0,.035,.39);revolver.add(barrel);
    box(revolver,.025,.025,.035,0,.085,.51,M.trim);box(revolver,.04,.065,.025,0,.055,-.02,M.steel);
    // SMG: compact receiver, long magazine, folded stock.
    box(smg,.1,.13,.42,0,0,.16,M.steel);box(smg,.075,.2,.1,0,-.13,.06,M.trim);
    box(smg,.05,.05,.2,0,.005,.42,M.trim);box(smg,.06,.16,.07,0,-.1,.2,M.trim);
    box(smg,.03,.05,.16,0,.02,-.12,M.trim);
    // Shotgun: wide twin barrels and a wooden stock.
    box(shotgun,.13,.11,.5,0,.01,.2,M.steel);box(shotgun,.1,.1,.16,0,-.02,-.16,mat('#6b5334'));
    box(shotgun,.05,.05,.44,0,.075,.24,M.trim);box(shotgun,.11,.06,.1,0,-.06,.1,mat('#6b5334'));
    // Rifle: long barrel, scope, straight stock.
    box(rifle,.09,.11,.62,0,0,.26,M.steel);box(rifle,.08,.13,.2,0,-.02,-.2,mat('#4a4a3c'));
    box(rifle,.04,.04,.5,0,.02,.62,M.trim);
    const scope=new THREE.Mesh(new THREE.CylinderGeometry(.035,.035,.22,8),M.trim);scope.rotation.x=Math.PI/2;scope.position.set(0,.1,.24);rifle.add(scope);
    box(rifle,.05,.1,.08,0,-.1,.12,M.trim);
    // Recortada C-2: sawn-off twin tubes, stubby grip, no stock.
    box(compact,.15,.12,.34,0,.01,.14,M.steel);box(compact,.12,.11,.1,0,-.03,-.1,mat('#6b5334'));
    box(compact,.06,.06,.3,0,.08,.18,M.trim);box(compact,.13,.05,.08,0,-.07,.06,mat('#6b5334'));
    // Carabina V-9: mid-length receiver, curved magazine, slim handguard.
    box(carbine,.1,.12,.5,0,0,.2,M.steel);box(carbine,.08,.14,.18,0,-.02,-.16,mat('#3f4a44'));
    box(carbine,.05,.05,.34,0,.01,.5,M.trim);
    const cMag=new THREE.Mesh(new THREE.BoxGeometry(.06,.2,.09),M.trim);cMag.position.set(0,-.14,.1);cMag.rotation.x=.22;carbine.add(cMag);
    box(carbine,.03,.05,.14,0,.09,.16,M.trim);
    // Tiradora Larga: long barrel, big scope, bipod hint.
    box(marksman,.085,.1,.78,0,0,.34,M.steel);box(marksman,.08,.13,.22,0,-.02,-.24,mat('#3a3f36'));
    box(marksman,.035,.035,.66,0,.02,.78,M.trim);
    const mScope=new THREE.Mesh(new THREE.CylinderGeometry(.042,.042,.3,8),M.trim);mScope.rotation.x=Math.PI/2;mScope.position.set(0,.11,.3);marksman.add(mScope);
    box(marksman,.05,.1,.08,0,-.1,.14,M.trim);
    // Ráfaga B-3: bullpup receiver, straight box magazine, carry handle.
    box(burst,.1,.12,.46,0,0,.18,M.steel);box(burst,.08,.13,.2,0,-.02,-.18,mat('#3d4a46'));
    box(burst,.05,.05,.3,0,.01,.46,M.trim);
    const bMag=new THREE.Mesh(new THREE.BoxGeometry(.055,.22,.08),M.trim);bMag.position.set(0,-.15,.06);burst.add(bMag);
    box(burst,.09,.03,.2,0,.1,.16,M.trim);
    // Cazador .44: long heavy barrel, big cylinder, oversized grip.
    box(magnum,.115,.16,.24,0,-.01,.1,M.steel);box(magnum,.11,.22,.13,0,-.13,-.02,M.trim);
    const mDrum=new THREE.Mesh(new THREE.CylinderGeometry(.095,.095,.2,8),M.steel);mDrum.rotation.x=Math.PI/2;mDrum.position.set(0,.02,.15);magnum.add(mDrum);
    const mBarrel=new THREE.Mesh(new THREE.CylinderGeometry(.042,.042,.44,8),M.steel);mBarrel.rotation.x=Math.PI/2;mBarrel.position.set(0,.04,.48);magnum.add(mBarrel);
    box(magnum,.03,.03,.04,0,.1,.68,M.trim);
    // Corredera P-8: pump shotgun with a slide under the barrel.
    box(pump,.13,.11,.56,0,.01,.22,M.steel);box(pump,.1,.11,.18,0,-.02,-.18,mat('#5c4a33'));
    box(pump,.05,.05,.5,0,.075,.26,M.trim);
    const slide=new THREE.Mesh(new THREE.BoxGeometry(.11,.07,.16),mat('#6b5334'));slide.position.set(0,-.05,.3);pump.add(slide);
    box(pump,.12,.06,.1,0,-.07,.08,mat('#6b5334'));
    // Mula-60: belt-fed, bipod, heavy receiver.
    box(lmg,.13,.15,.6,0,0,.24,M.steel);box(lmg,.1,.14,.22,0,-.02,-.22,mat('#3a423c'));
    box(lmg,.055,.055,.54,0,.02,.6,M.trim);
    const belt=new THREE.Mesh(new THREE.BoxGeometry(.1,.16,.14),M.trim);belt.position.set(.09,-.1,.1);lmg.add(belt);
    for(const sx of [-1,1])box(lmg,.02,.16,.02,sx*.05,-.12,.5,M.trim);
    for(const model of [revolver,smg,shotgun,rifle,compact,carbine,marksman,burst,magnum,pump,lmg])model.visible=false;
    muzzle=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:'#ffd797',transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));muzzle.position.set(0,.01,.43);muzzle.scale.set(.65,.65,1);muzzle.visible=false;gun.add(muzzle);
  }
  return {...body,gun,muzzle,gunModels,gunRig};
}
const player=human();scene.add(player.group);player.group.position.set(MISSION.start.x,0,MISSION.start.z);player.group.rotation.y=Math.PI;
const torch=new THREE.SpotLight('#fff3d6',2.8,48,Math.PI/7,.45,1.2);torch.position.set(0,1.6,11);scene.add(torch);scene.add(torch.target);
let enemies=[],effects=[];
let phase='intro',health=100,ammo=MISSION.initialAmmo,reserve=MISSION.initialReserve,kills=0;
let profile=loadProfile(),profilePersistent=saveProfile(profile),activeWeapon=WEAPONS.pistol,activeSkin='survivor';
let runMaxHealth=100,runSpeedScale=1,runDamageScale=1;
let currentRunId=null,lastRunAward=0,shopReturnPhase='intro',shopReturnFocus=null;
let missionProgress=createMission(),interaction=null,noiseCount=0,invulnerable=0;
let lastStage='',lastDistance=-1,lastThreat='',growlTime=4,stepTime=0;
let yaw=0,pitch=0,shotCooldown=0,reloadTime=0,reloadBlend=0,gameTime=0,walkTime=0,damageFade=0,recoil=0,muzzleTime=0;
let lastShot=null;
let reloadTotal=0,reloadMode=null,shoveCooldown=0,shoveTime=0,lastShove=null,firePointerId=null;
// v1.2: weapon-swap animation timer, and the burst-fire queue.
let swapTime=0,burstLeft=0,burstTimer=0;
const SWAP_TIME=.42;
let fireHeld=false,stickX=0,stickY=0,lastHealth=-1,lastAmmo=-1,lastKills=-1;
let aiming=false,aimBlend=0;
let controlSettings=loadControls();
let joystickSettings=loadJoystick();
let waveProgress=createWaveState(),waveSpawned=0;
let appliedWaves=new Set(),lastWaveSpawns=[],lastWaveOrigin=null;
// Falling zombies: the director picks a ledge, the renderer owns gravity.
const fallDirector=createFallDirector();
const fallStats={dead:0,enraged:0,crawler:0,spawned:0};
let lastFall=null;
const maxReinforcements=WAVES.reduce((sum,wave)=>sum+wave.members.length,0);
// How long the "gets up furious" pose takes before the zombie is upright.
const GETUP_TIME=.85;
// v1.3: one-shot animation windows for the lunge and the flinch.
const ATTACK_SWING=.42;
const HIT_FLINCH=.26;
let statusTime=0,statusText='';
const keys=new Set();
let soundOn=true;
const audioEngine=createAudioEngine();
function initAudio(){audioEngine.resume();}
// Legacy call sites keep their names; the engine owns the synthesis.
function sound(type,pan=0,extra){ 
  if(!soundOn)return;
  if(type==='shot')audioEngine.shot(extra||activeWeapon.id,pan);
  else if(type==='hit')audioEngine.impact(pan,true);
  else if(type==='world')audioEngine.impact(pan,false);
  else if(type==='reload')audioEngine.reload(pan);
  else if(type==='growl')audioEngine.growl(pan,extra||10);
  else if(type==='step')audioEngine.step(pan,extra||1);
  else if(type==='hurt')audioEngine.hurt(pan);
  else if(type==='pickup')audioEngine.pickup(pan);
  else audioEngine.ui(type);
}
/** Stereo position of a world point relative to where the camera is looking. */
function panFor(position){
  const p=player.group.position;
  const dx=position.x-p.x,dz=position.z-p.z;
  const rightX=Math.cos(yaw),rightZ=Math.sin(yaw);
  const distance=Math.hypot(dx,dz)||1;
  return clamp((dx*rightX+dz*rightZ)/distance,-1,1);
}
function toast(text,duration=2.5){statusText=text;statusTime=duration;$('status').textContent=text;$('status').classList.add('visible');}
function spawnEnemy(spawn,i,incoming=false){
    if(enemies.some(e=>e.id===spawn.id))return null;
    if(incoming&&collides(spawn.x,spawn.z,.38))return null;
    const e=human(true,spawn.kind==='brute'?5:spawn.kind==='resistant'?4:i%4,spawn.kind);
    let x=spawn.x,z=spawn.z;
    if(collides(x,z,.35)){
      for(const offset of [-1.7,1.7,-3.4,3.4,5,-5]){
        if(!collides(x+offset,z,.35)&&Math.abs(x+offset)<8){x+=offset;break;}
      }
      if(collides(x,z,.35))x=0;
    }
    e.id=spawn.id;e.kind=spawn.kind;e.hp=e.maxHp=spawn.hp;e.speed=spawn.speed;
    e.group.position.set(x,0,z);e.group.rotation.y=spawn.yaw;
    if(e.kind==='brute')e.group.scale.set(1.18,1.12,1.18);
    else if(e.kind==='resistant')e.group.scale.set(1.07,1.02,1.07);
    e.home=new V(x,0,z);e.lastKnown=e.home.clone();e.wander=e.home.clone();
    e.attack=.5;e.anim=i*1.7;e.dead=false;e.fade=0;e.alert=0;e.mode='idle';e.wanderTimer=2+i%6;e.stagger=0;e.getup=0;
    // v1.4: roles. A resistant zombie waits inside a doorway and bursts out; a
    // runner flanks; a shambler that gets hurt badly turns coward and runs.
    e.role=spawn.kind==='resistant'?'ambusher':spawn.kind==='runner'?'runner':
      (i%11===7?'coward':spawn.kind);
    e.waiting=e.role==='ambusher';
    e.heardNoise=0;e.memoryAge=99;e.fleeing=false;e.fleeUntil=0;e.ambushCooldown=0;
    e.reinforcement=incoming;
    scene.add(e.group);enemies.push(e);
    // v1.4: register the archetype once; every later body of the same kind and
    // variant reuses the same instanced buffers.
    zombieInstancer.register(e);
    zombieInstancer.registerFar(e);
    return e;
}
function populateDistrict(){
  createEnemySpawns(missionProgress.route).forEach((spawn,i)=>spawnEnemy(spawn,i));
}
function spawnWave(wave){
  if(phase!=='playing'||missionProgress.stage==='complete'||appliedWaves.has(wave.id))return;
  appliedWaves.add(wave.id);
  const p=player.group.position;
  const occupied=enemies.filter(e=>!e.dead).map(e=>({x:e.group.position.x,z:e.group.position.z}));
  const planned=planWaveSpawns(wave,{x:p.x,z:p.z},{occupied,blocked:(x,z)=>collides(x,z,.38)});
  const records=[];
  for(const descriptor of planned){
    if(waveSpawned>=maxReinforcements)break;
    const kind=descriptor.kind;
    const speed=kind==='runner'?2.05:kind==='brute'?.82:kind==='resistant'?1.02:1.2;
    const enemy=spawnEnemy({...descriptor,hp:ENEMY_TYPES[kind].hp,speed},enemies.length,true);
    if(!enemy)continue;
    enemy.lastKnown.copy(p);enemy.alert=12;enemy.mode='investigate';
    waveSpawned++;
    records.push({id:enemy.id,kind,x:enemy.group.position.x,z:enemy.group.position.z});
  }
  lastWaveSpawns=records;lastWaveOrigin={x:p.x,z:p.z};
  const number=WAVES.findIndex(w=>w.id===wave.id)+1;
  const ladder=ESCALATION.find(step=>step.wave===number);
  toast(records.length?`Oleada ${number}/${WAVES.length} · ${ladder?ladder.adds:'refuerzos'}: llegan ${records.length} infectados.`:'Los infectados no encontraron una entrada segura.',3);
}
function updateWaves(){
  const result=advanceWaves(waveProgress,{z:player.group.position.z,time:gameTime,active:phase==='playing',complete:missionProgress.stage==='complete'});
  waveProgress=result.state;
  if(result.arriving)spawnWave(result.arriving);
  if(result.announced){
    const number=WAVES.findIndex(w=>w.id===result.announced.id)+1;
    const ladder=ESCALATION.find(step=>step.wave===number);
    toast(`Se acerca la oleada ${number}/${WAVES.length}${ladder?` · ${ladder.adds}`:''}. Busca una ruta libre.`,result.announced.delay);
    sound('growl',0,14);
  }
}
function makeNoise(radius=30){
  noiseCount++;
  const p=player.group.position;
  // v1.4: a noise is a *strength*, not a boolean. A suppressed weapon has a
  // small radius and a low strength, so it is heard only up close; a shotgun
  // carries. The zombie's own perception step turns this into an alert.
  const strength=clamp(radius/34,0,1);
  for(const e of enemies){
    if(e.dead||e.falling)continue;
    const distance=e.group.position.distanceTo(p);
    if(distance<radius){
      e.heardNoise=Math.max(e.heardNoise||0,strength);
      // A heard noise gives a position to investigate, but not certainty.
      if((e.alert||0)<PERCEPTION.chaseThreshold){
        e.lastKnown.copy(p);e.memoryAge=0;
      }
    }
  }
}
/**
 * A zombie stepping off a ledge. It is a real enemy from the first frame: it
 * has hp, a hitbox and an AI state, it is simply still in the air. Gravity and
 * spin are integrated in tick(); the outcome is decided at impact.
 */
function spawnFalling(drop){
  if(phase!=='playing')return null;
  const zone=drop.zone;
  const kind=drop.outcome==='enraged'?'runner':drop.outcome==='crawler'?'shambler':'shambler';
  const e=human(true,kind==='runner'?5:2,kind);
  e.id=`fall-${drop.index}`;e.kind=kind;e.hp=e.maxHp=ENEMY_TYPES[kind].hp;
  e.speed=kind==='runner'?2.05:1.15;
  e.group.position.set(zone.x,zone.height,zone.z);
  e.group.rotation.y=Math.atan2(player.group.position.x-zone.x,player.group.position.z-zone.z);
  e.home=new V(zone.x,0,zone.z);e.lastKnown=player.group.position.clone();e.wander=e.home.clone();
  e.attack=.5;e.anim=0;e.dead=false;e.fade=0;e.alert=0;e.mode='idle';e.wanderTimer=3;e.stagger=0;e.getup=0;
  e.reinforcement=true;e.falling=true;e.fallT=0;e.fallTime=drop.fallTime;
  // v1.4: the roll is kept, but it no longer decides the outcome on its own —
  // impactOutcome() weighs it against the actual fall height.
  e.fallRoll=drop.roll??Math.random();
  // v1.4: the height travels with the body. v1.3 re-derived it from the zone id
  // at landing time, which silently fell back to 12 m for any zone not in the
  // static table — so every test drop and every future zone died on impact.
  e.fallHeight=zone.height;
  e.fallOutcome=drop.outcome;e.fallZone=zone.id;e.spin=(zone.side>0?-1:1)*rand(1.6,3.4);
  e.damageMul=1;e.buff=null;e.prone=false;e.corpse=false;e.aura=null;
  e.role=kind==='runner'?'runner':'shambler';e.waiting=false;
  e.heardNoise=0;e.memoryAge=99;e.fleeing=false;e.fleeUntil=0;e.ambushCooldown=0;
  scene.add(e.group);enemies.push(e);
  zombieInstancer.register(e);
  fallStats.spawned++;
  lastFall={zone:zone.id,outcome:drop.outcome,height:zone.height,fallTime:drop.fallTime,at:gameTime};
  return e;
}
/**
 * Impact: dust, sound, and the outcome.
 *
 * v1.4: the outcome now comes from the physical fall height (impactOutcome)
 * instead of an independent dice roll, and the landing state is applied through
 * one contract (landingState). The bug this fixes: v1.3 never cleared
 * `group.rotation.z`, so a body that fell spinning stood up and walked *on its
 * side* — the pose solver was right, the root transform was stale.
 */
function landFalling(e){
  const p=e.group.position;
  // v1.4: the height the body actually fell from, carried on the enemy. The
  // zone lookup is only a fallback for bodies spawned before this field existed.
  const height=Number.isFinite(e.fallHeight)?e.fallHeight:(e.fallZone?FALL_HEIGHT(e.fallZone):12);
  // The director's roll only decides the ambiguous middle band.
  const outcome=impactOutcome({height,roll:e.fallRoll??.5});
  const landing=landingState({outcome,height,x:p.x});
  e.falling=false;
  // Dust burst at the landing point, panned by where it happened.
  for(let i=0;i<7;i++){
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,
      color:'#b9b3a2',transparent:true,depthWrite:false}));
    sprite.position.set(p.x+rand(-.5,.5),rand(.05,.5),p.z+rand(-.5,.5));
    sprite.scale.setScalar(rand(.3,.7));scene.add(sprite);
    effects.push({object:sprite,life:.55,max:.55,type:'spark',
      velocity:new V(rand(-1.1,1.1),rand(.3,1.2),rand(-1.1,1.1))});
  }
  const pan=panFor(p);
  sound('world',pan);
  e.fallOutcome=outcome;
  fallStats[outcome]=(fallStats[outcome]||0)+1;
  // --- the landing contract, applied in full -----------------------------
  // Clear the spin first: this is the exact field v1.3 forgot.
  e.group.rotation.z=landing.rotationZ;
  e.group.rotation.x=landing.rootPitch;
  e.group.position.y=landing.y;
  e.prone=landing.prone;
  e.getup=landing.gettingUp?GETUP_TIME:0;
  e.stagger=Math.max(e.stagger||0,landing.stagger);
  e.impactSpeed=landing.impactSpeed;
  if(landing.dead){
    e.dead=true;e.corpse=true;e.hp=0;e.fade=0;
    e.group.rotation.z=1.55;e.group.rotation.x=0;
    e.group.position.y=settleOnGround({x:p.x,rootY:0,state:'dead'});
    if(e.shadow)e.shadow.visible=true;
    toast('Cayó desde la azotea. No se levanta.',2.2);
    return;
  }
  const applied=applyOutcome({...e,time:gameTime},outcome);
  e.speed=applied.speed;e.damageMul=applied.damageMul;e.buff=applied.buff;
  if(landing.prone){
    toast('Quedó arrastrándose. Es lento, pero sigue viniendo.',2.4);
    sound('growl',pan,6);
  }else{
    e.alert=14;e.mode='chase';e.lastKnown.copy(player.group.position);
    // Aura: a red ring at its feet for the duration of the rage.
    const aura=new THREE.Mesh(new THREE.RingGeometry(.42,.62,20),
      new THREE.MeshBasicMaterial({color:'#e2563f',transparent:true,opacity:.55,side:THREE.DoubleSide,depthWrite:false}));
    aura.rotation.x=-Math.PI/2;aura.position.y=.03;e.group.add(aura);e.aura=aura;
    toast('¡Se levanta furioso! Corre y pega más fuerte.',2.6);
    sound('growl',pan,4);
  }
}
/**
 * Airborne integration.
 *
 * v1.4: the trunk spin is integrated from the real fall time and then handed to
 * the landing contract, so the body always arrives in a state the pose solver
 * can drive. The horizontal position is also kept out of colliders, so a body
 * cannot land inside a car and then walk out of it.
 */
function updateFalling(dt){
  for(const e of enemies){
    if(!e.falling||e.dead)continue;
    e.fallT+=dt;
    const progress=Math.min(1,e.fallT/Math.max(.001,e.fallTime));
    const height=Number.isFinite(e.fallHeight)?e.fallHeight:(e.fallZone?FALL_HEIGHT(e.fallZone):12);
    e.group.position.y=height*(1-progress*progress);
    e.group.rotation.z=e.spin*progress;
    e.group.rotation.x=-.35*progress;
    if(progress>=1)landFalling(e);
  }
}
function FALL_HEIGHT(zoneId){
  const zone=FALL_ZONES.find(z=>z.id===zoneId);
  return zone?zone.height:12;
}
function interact(){
  if(phase!=='playing')return;
  const item=nearbyInteraction(player.group.position,missionProgress);
  if(!item)return;
  if(item.kind==='health'&&health>=runMaxHealth){toast('Ya tienes la salud completa. Puedes dejar el botiquín.',2);return;}
  if(item.kind==='fork'){openRouteChoice();return;}
  const result=applyInteraction(missionProgress,item.id);
  if(!result.event)return;
  missionProgress=result.progress;
  reserve+=result.reward.ammo||0;health=Math.min(runMaxHealth,health+(result.reward.health||0));
  sound('pickup');
  if(result.event==='supplies'){
    makeNoise(28);toast(`Alijo de suministros: +${SUPPLIES_BONUS} créditos si escapas.`,4);
  }else if(result.event==='extract'){endGame(true);}
  else if(result.event==='ammo'){toast(`+${result.reward.ammo} balas. Cada disparo cuenta.`,3);}
  else if(result.event==='health'){toast(`+${result.reward.health} salud`,2);}
  updateHUD(true);
}
/** The fork: two routes, chosen once, with their trade-off spelled out. */
function openRouteChoice(){
  if(phase!=='playing'||missionProgress.stage!=='route')return;
  phase='route';
  resetInputs();
  $('route').classList.remove('hidden');
  $('route-short').focus({preventScroll:true});
}
function chooseRoute(id){
  if(phase!=='route')return;
  const result=applyInteraction(missionProgress,`fork`,id);
  if(!result.event)return;
  missionProgress=result.progress;
  $('route').classList.add('hidden');
  phase='playing';
  const route=ROUTES[id]||ROUTES.short;
  // The short route is the dangerous one: its extra infected arrive now.
  if(route.extraEnemies>0){
    const base=enemies.length;
    createEnemySpawns(id).slice(36).forEach((spawn,i)=>spawnEnemy(spawn,base+i));
  }
  toast(`${route.name}: ${route.description}`,4);
  sound('ui');
  updateHUD(true);
}
function lineBlocked(a,b){
  const dx=b.x-a.x,dz=b.z-a.z;
  for(const o of obstacles){
    let near=0,far=1;
    for(const [start,delta,mid,half]of [[a.x,dx,o.x,o.rx],[a.z,dz,o.z,o.rz]]){
      if(Math.abs(delta)<.0001){if(Math.abs(start-mid)>half){near=2;break;}}
      else{let t1=(mid-half-start)/delta,t2=(mid+half-start)/delta;if(t1>t2)[t1,t2]=[t2,t1];near=Math.max(near,t1);far=Math.min(far,t2);}
    }
    if(near<=far&&far>.03&&near<.97)return true;
  }
  return false;
}
function start(isContinue=false){
  if(!['intro','end'].includes(phase))return;
  refreshProfile();
  const prepared=beginRun(profile,newRunId());
  currentRunId=prepared.runId;lastRunAward=0;
  commitProfile(prepared.profile);
  applyLoadout(prepared.loadout.weapon,prepared.loadout.skin);
  runMaxHealth=prepared.loadout.maxHealth;runSpeedScale=prepared.loadout.speedScale;runDamageScale=prepared.loadout.damageScale;
  const totalAmmo=prepared.loadout.magazine+prepared.loadout.reserve;
  initAudio();audioEngine.startAmbience();
  enemies.forEach(e=>scene.remove(e.group));effects.forEach(e=>{scene.remove(e.object);if(e.type==='line')e.object.geometry.dispose();e.object.material.dispose();});enemies=[];effects=[];
  feedback.clear();
  health=runMaxHealth;ammo=Math.min(activeWeapon.magazine,totalAmmo);reserve=totalAmmo-ammo;kills=0;reloadTime=reloadBlend=0;shotCooldown=0;gameTime=0;yaw=pitch=0;recoil=0;lastShot=null;stepTime=0;
  reloadTotal=shoveCooldown=shoveTime=0;reloadMode=null;lastShove=null;
  waveProgress=createWaveState();waveSpawned=0;appliedWaves=new Set();lastWaveSpawns=[];lastWaveOrigin=null;
  fallDirector.reset();fallStats.dead=fallStats.enraged=fallStats.crawler=fallStats.spawned=0;lastFall=null;
  missionProgress=createMission();interaction=null;noiseCount=0;invulnerable=1;lastStage='';lastDistance=-1;lastThreat='';growlTime=4;
  player.group.position.set(MISSION.start.x,0,MISSION.start.z);player.group.rotation.y=Math.PI;camera.position.set(MISSION.start.x+.52,1.68,MISSION.start.z+2.8);
  aimBlend=0;camera.fov=58;camera.updateProjectionMatrix();
  player.group.visible=true;phase='playing';resetInputs();
  characterVisuals.animate(player,{phase:0,moving:false,dt:0,snap:true});
  if(isContinue){
    const cp=loadCheckpoint();
    if(cp){
      player.group.position.set(cp.x,0,cp.z);
      health=Math.min(runMaxHealth,cp.hp||runMaxHealth);
      ammo=cp.ammo||ammo;
      reserve=cp.reserve||reserve;
      kills=cp.kills||0;
      gameTime=cp.time||0;
      toast('Checkpoint restaurado: Posición y recursos cargados',2.0);
    }
  }
  updateCamera(0,true);updatePlayerPose(0,true);
  $('intro').classList.add('hidden');$('end').classList.add('hidden');$('paused').classList.add('hidden');$('route').classList.add('hidden');$('hud').classList.remove('hidden');$('damage').style.opacity=0;
  populateDistrict();toast('Sigue la avenida hasta la bifurcación. Ahorra munición.',5);updateHUD(true);window.__gameState=state;
}
function state(detailed=false){return {elapsed:gameTime,population:detailed?enemies.filter(e=>!e.dead).map(e=>({id:e.id,x:e.group.position.x,z:e.group.position.z,kind:e.kind,hp:e.hp,maxHp:e.maxHp,reinforcement:e.reinforcement,name:ENEMY_TYPES[e.kind].name,mode:e.mode,role:e.role,alert:Number((e.alert||0).toFixed(3)),prone:Boolean(e.prone),falling:Boolean(e.falling),rotationZ:Number(e.group.rotation.z.toFixed(3)),rotationX:Number(e.group.rotation.x.toFixed(3)),y:Number(e.group.position.y.toFixed(3)),waiting:Boolean(e.waiting),fleeing:Boolean(e.fleeing)})):undefined,obstacles:detailed?obstacles.map(o=>({...o})):undefined,version:'1.4',profile:{...profile,ownedWeapons:[...profile.ownedWeapons],ownedSkins:[...profile.ownedSkins],ownedAttachments:[...profile.ownedAttachments],attachments:Object.fromEntries(Object.entries(profile.attachments||{}).map(([k,v])=>[k,[...v]])),completedRuns:[...profile.completedRuns],ammo:{...profile.ammo}},profilePersistent,run:{maxHealth:runMaxHealth,speedScale:runSpeedScale,damageScale:runDamageScale},route:missionProgress.route,routeStage:missionProgress.stage,falls:{...fallStats,last:lastFall?{...lastFall}:null,used:fallDirector.usedZones,cooldown:Number(fallDirector.cooldown.toFixed(2))},attachments:{mounted:[...(profile.attachments&&profile.attachments[activeWeapon.id]||[])],resolved:{magazine:activeWeapon.magazine,damage:activeWeapon.damage,noise:activeWeapon.noise,recoil:activeWeapon.recoil,spread:activeWeapon.spread||0,aimRange:activeWeapon.aimRange,moveScale:activeWeapon.moveScale}},waves:{next:waveProgress.next,pending:waveProgress.pending?{...waveProgress.pending}:null,arrived:[...waveProgress.arrived],spawned:waveSpawned,max:maxReinforcements,lastOrigin:lastWaveOrigin?{...lastWaveOrigin}:null,lastSpawns:lastWaveSpawns.map(e=>({...e}))},joystick:{...joystickSettings},joystickEditing:joystickEditor.isOpen(),reloadTime,reloadTotal,reloadMode,shoveCooldown,shoveTime,lastShove:lastShove?{...lastShove,from:lastShove.from?[...lastShove.from]:null,to:lastShove.to?[...lastShove.to]:null}:null,weapon:activeWeapon.id,skin:activeSkin,runId:currentRunId,lastRunAward,phase,health,ammo,reserve,kills,mission:{...missionProgress,collected:[...missionProgress.collected]},target:missionTarget(missionProgress),interaction:interaction?.id||null,noiseCount,aiming,fov:camera.fov,sensitivity:{...controlSettings},enemies:enemies.filter(e=>!e.dead).length,alerted:enemies.filter(e=>!e.dead&&e.alert>0).length,position:player.group.position.toArray(),camera:camera.position.toArray(),yaw,pitch,viewDirection:camera.getWorldDirection(new V()).toArray(),aimPose:{body:player.upper.rotation.x,rightArm:player.arms[0].rotation.x,leftArm:player.arms[1].rotation.x,gun:player.gunRig.rotation.x},lastShot:lastShot?{...lastShot,from:[...lastShot.from],end:[...lastShot.end],direction:[...lastShot.direction],cameraDirection:[...lastShot.cameraDirection]}:null,visuals:{style:player.metadata?.styleId||activeSkin,resources:characterVisuals.getResourceStats(),blobShadows:enemies.filter(e=>!e.dead&&e.shadow).length+1,shadowMap:renderer.shadowMap.enabled,touch},renderer:{...lastRenderInfo},quality:{id:qualityId,label:quality.label,shadows:quality.shadows,fogLayers:quality.fogLayers,dust:quality.dust,pixelRatio:quality.pixelRatio,rain:quality.rain,smoke:quality.smoke,wet:quality.wet,lodDistance:quality.lodDistance,shadowMap:quality.shadowMap},fps:{cap:fpsCap,options:[...FPS_OPTIONS],...frameMeter.stats(),rendered:frameLimiter.rendered,skipped:frameLimiter.skipped},weather:{rain:rainField.count,smoke:smokePlumes.count,wet:wetResult.wet},zombies:{archetypes:zombieInstancer.archetypeCount,batches:zombieInstancer.drawCalls,instances:zombieInstancer.instanceCount,capacity:zombieInstancer.capacity},atmosphere:{fogLayers:fogLayers.layerCount,dust:dustField.count,grade:grade.strength},destroyedCity:destroyedCity.stats,missionMerge};}
function newRunId(){
  let bits;
  try{bits=[...crypto.getRandomValues(new Uint32Array(3))].map(n=>n.toString(36)).join('-');}
  catch(_){bits=Math.random().toString(36).slice(2)+Math.random().toString(36).slice(2);}
  return `run-${Date.now().toString(36)}-${bits}`;
}
function refreshProfile(){
  if(!profilePersistent)return;
  try{
    const raw=globalThis.localStorage.getItem(ECONOMY_KEY)??globalThis.localStorage.getItem(LEGACY_ECONOMY_KEY);
    profile=raw===null?defaultProfile():normalizeProfile(JSON.parse(raw));
  }catch(_){
    // Keep the in-memory wallet if storage becomes inaccessible mid-session.
    profilePersistent=false;
  }
}
function commitProfile(next){profile=next;profilePersistent=saveProfile(profile);updateProfileUI();}
const MUZZLE_Z={pistol:.43,revolver:.58,smg:.44,shotgun:.5,rifle:.66,compact:.36,carbine:.6,marksman:.86,burst:.56,magnum:.72,pump:.56,lmg:.72};
function applyLoadout(weaponId,skinId){
  const base=WEAPONS[weaponId]||WEAPONS.pistol;
  const mounted=(profile.attachments&&profile.attachments[base.id])||[];
  const previous=activeWeapon?activeWeapon.id:null;
  activeWeapon=resolveWeapon(base,mounted)||base;
  const skin=SKINS[skinId]||SKINS.survivor;activeSkin=skin.id;
  characterVisuals.applyPalette(player,skin);
  for(const [id,model]of Object.entries(player.gunModels))model.visible=id===activeWeapon.id;
  player.muzzle.position.z=MUZZLE_Z[activeWeapon.id]??.43;
  // v1.2: a real weapon swap plays the lower-and-raise animation, but only
  // mid-run — equipping in the refuge should not animate the gun.
  if(previous&&previous!==activeWeapon.id&&phase==='playing'){swapTime=SWAP_TIME;burstLeft=0;}
  $('weapon-name').textContent=mounted.length?`${activeWeapon.name} +${mounted.length}`:activeWeapon.name;
}
function updateProfileUI(message=''){
  $('wallet-value').textContent=profile.credits;$('wave').textContent=profile.credits;
  const weapon=WEAPONS[profile.weapon]||WEAPONS.pistol;
  const bought=profile.ammo[weapon.id]||0;
  const stats=runStats(weapon.id,profile.skin);
  $('loadout-summary').textContent=`${weapon.name} · ${SKINS[profile.skin].name} · ${weapon.startReserve+bought} balas · ${stats.maxHealth} vitales`;
  $('profile-save-note').classList.toggle('hidden',profilePersistent);
  $('reward-persistence').textContent=profilePersistent?'Guardado en este navegador o app':'No se pudo guardar: progreso solo para esta sesión';
  shop.render(profile,{persisted:profilePersistent,message});
}
function openShop(){
  if(!['intro','end'].includes(phase))return;
  shopReturnPhase=phase;shopReturnFocus=document.activeElement;refreshProfile();phase='shop';resetInputs();
  $('shop').classList.remove('hidden');updateProfileUI();
  $('shop').querySelector('.shop-close')?.focus({preventScroll:true});
}
function closeShop(){
  if(phase!=='shop')return;
  $('shop').classList.add('hidden');phase=shopReturnPhase;
  applyLoadout(profile.weapon,profile.skin);shopReturnFocus?.focus();
}
function shopAction(kind,id,action){
  if(phase!=='shop')return;
  refreshProfile();
  const result=action==='buy'?purchase(profile,kind,id)
    :action==='equip'?equip(profile,kind,id)
    :action==='mount'?equipAttachmentOn(profile,id)
    :action==='unequip'?unequipAttachmentFrom(profile,id)
    :null;
  if(!result)return;
  if(result.ok){commitProfile(result.profile);applyLoadout(profile.weapon,profile.skin);}
  updateProfileUI(result.message);
}
function setAim(value){
  if(value&&phase!=='playing')return;
  aiming=Boolean(value);
  $('aim').setAttribute('aria-pressed',String(aiming));
  $('aim').setAttribute('aria-label',aiming?'Dejar de apuntar':'Apuntar');
  $('aim-label').textContent=aiming?'APUNTANDO':'APUNTAR';
  $('hud').classList.toggle('is-aiming',aiming);
}
function syncControls(){
  $('look-sensitivity').value=controlSettings.look;
  $('aim-sensitivity').value=controlSettings.aim;
  $('look-value').textContent=`${controlSettings.look}%`;
  $('aim-value').textContent=`${controlSettings.aim}%`;
  // v1.3: the quality preset is a real setting, so it is shown in the same panel.
  // v1.4: four tiers plus a frame cap, both persisted.
  const order=[...PROFILE_ORDER];
  $('quality-select').max=String(order.length-1);
  $('quality-select').value=String(Math.max(0,order.indexOf(qualityId)));
  $('quality-value').textContent=QUALITY_PRESETS[qualityId].label;
  const fpsIndex=Math.max(0,FPS_OPTIONS.indexOf(fpsCap));
  $('fps-select').value=String(fpsIndex);
  $('fps-value').textContent=`${fpsCap}`;
}
function updateControls(){
  controlSettings=normalizeControls({look:Number($('look-sensitivity').value),aim:Number($('aim-sensitivity').value)});
  syncControls();
  $('settings-saved').textContent=saveControls(controlSettings)?'Guardado en este dispositivo':'Aplicado para esta sesión';
}
function applyJoystick(){
  const layout=joystickLayout(joystickSettings,innerWidth,innerHeight),el=$('joystick'),knob=$('stick');
  Object.assign(el.style,{left:`${layout.left}px`,top:`${layout.top}px`,bottom:'auto',width:`${layout.size}px`,height:`${layout.size}px`});
  const size=Math.round(layout.size*.36);
  Object.assign(knob.style,{width:`${size}px`,height:`${size}px`,left:`calc(50% - ${size/2}px)`,top:`calc(50% - ${size/2}px)`});
}
function openJoystickEditor(){
  if(phase!=='paused'||joystickEditor.isOpen())return;
  resetInputs();$('paused').classList.add('hidden');joystickEditor.open(joystickSettings);
}
function closeJoystickEditor(){
  if(!joystickEditor.isOpen())return;
  joystickEditor.close();resetInputs();$('paused').classList.remove('hidden');$('edit-joystick').focus({preventScroll:true});
}
function shove(){
  if(phase!=='playing'||shoveCooldown>0)return;
  reloadTime=reloadTotal=0;reloadMode=null;
  shoveTime=COMBAT.shoveAnimation;shoveCooldown=COMBAT.shoveCooldown;
  const p=player.group.position;
  const candidates=enemies.filter(e=>!e.dead&&Math.hypot(e.group.position.x-p.x,e.group.position.z-p.z)<=COMBAT.shoveRange&&!lineBlocked(p,e.group.position))
    .map(e=>({id:e.id,x:e.group.position.x,z:e.group.position.z,hp:e.hp,kind:e.kind}));
  const chosen=chooseShoveTarget({x:p.x,z:p.z,yaw},candidates);
  const target=chosen?enemies.find(e=>e.id===chosen.id):null;
  lastShove={targetId:target?.id||null,hit:Boolean(target),time:gameTime,from:null,to:null};
  if(target){
    const effect=shoveEffect(target.kind),pos=target.group.position;
    lastShove.from=pos.toArray();
    const dx=pos.x-p.x,dz=pos.z-p.z,n=Math.hypot(dx,dz);
    const ux=n>1e-8?dx/n:Math.sin(yaw),uz=n>1e-8?dz/n:-Math.cos(yaw);
    // Small collision-aware steps prevent pushing through thin street furniture.
    const steps=Math.ceil(effect.distance/.07);
    for(let i=0;i<steps;i++)moveEntity(pos,ux*effect.distance/steps,uz*effect.distance/steps,.3);
    target.stagger=Math.max(target.stagger,effect.stagger);target.attack=Math.max(target.attack,effect.stagger);
    lastShove.to=pos.toArray();
    toast(target.kind==='brute'?'El bruto apenas retrocede. ¡Muévete!':'Lo apartaste. Aprovecha para escapar.',1.8);
  }else toast('No hay un infectado al alcance, delante de ti.',1.5);
  sound('hit');makeNoise(6);updateHUD();
}
function reload(){
  if(phase!=='playing'||reloadTime>0||shoveTime>0||ammo===activeWeapon.magazine)return;
  if(reserve<=0){toast('Sin balas de reserva. Busca cajas o evita a los infectados.',2);return;}
  reloadTotal=reloadDuration(activeWeapon.reload,ammo);reloadTime=reloadTotal;
  reloadMode=ammo>0?'manual':'automatic';
  toast(reloadMode==='manual'?'Recarga manual rápida…':'Cargador vacío: recarga automática más lenta…',reloadTotal);
  sound('reload');updateHUD();
}
const shotRay=new THREE.Raycaster();
function visibleInWorld(object){
  for(let parent=object;parent;parent=parent.parent)if(!parent.visible)return false;
  return true;
}
function worldHit(origin,direction,range){
  if(range<=0)return null;
  shotRay.set(origin,direction);shotRay.near=.001;shotRay.far=range;
  const solids=shotBlockers.filter(visibleInWorld),sides=new Map();
  // Ray-only double-sided testing also catches exits from embedded barrels.
  // Restore render materials synchronously, even if an intersection fails.
  for(const object of solids){
    if(!sides.has(object.material)){
      sides.set(object.material,object.material.side);
      object.material.side=THREE.DoubleSide;
    }
  }
  try{return shotRay.intersectObjects(solids,false)[0]||null;}
  finally{for(const [material,side]of sides)material.side=side;}
}
function enemyTargets(){
  return enemies.filter(e=>!e.dead).map(e=>{
    const p=e.group.position,s=e.group.scale;
    return {id:e.id,enemy:e,bounds:{
      min:{x:p.x-.44*s.x,y:p.y+.10*s.y,z:p.z-.44*s.z},
      max:{x:p.x+.44*s.x,y:p.y+(e.kind==='brute'?2.18:2.08)*s.y,z:p.z+.44*s.z}
    }};
  });
}
function traceBullet(origin,direction,range,targets){
  const wall=worldHit(origin,direction,range);
  let distance=wall?wall.distance:range,target=null;
  for(const item of targets){
    const hit=rayBox(origin,direction,item.bounds,range);
    if(hit!==null&&hit<distance-.001){distance=hit;target=item.enemy;}
  }
  return {from:origin.clone(),end:origin.clone().addScaledVector(direction,distance),
    target,impact:target?'enemy':wall?'world':'air',direction:direction.clone()};
}
function traceShot(){
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  const origin=camera.position.clone(),view=camera.getWorldDirection(new V());
  const range=aiming?activeWeapon.aimRange:activeWeapon.range;
  const targets=enemyTargets(),viewRange=range+4;
  const wall=worldHit(origin,view,viewRange);
  let point=wall?wall.point.clone():origin.clone().addScaledVector(view,viewRange);
  const candidates=aimCandidates({origin,direction:view,targets,range:viewRange,
    horizontalAssist:aiming?(touch?.16:.12):(touch?.21:.18),
    verticalAssist:aiming?.035:.055});
  for(const candidate of candidates){
    // A reticle on nearby cover must not select an infected behind it.
    if(wall&&wall.distance<candidate.distance-.025)continue;
    const proposed=new V(candidate.point.x,candidate.point.y,candidate.point.z);
    const sight=proposed.clone().sub(origin),distance=sight.length();
    if(distance>.001&&worldHit(origin,sight.normalize(),Math.max(0,distance-.025)))continue;
    point=proposed;break;
  }
  const muzzle=player.muzzle.getWorldPosition(new V());
  const shoulder=player.gunRig.getWorldPosition(new V());
  const barrel=muzzle.clone().sub(shoulder),barrelLength=barrel.length();
  // Camera peeking over a car cannot let a barrel embedded in it shoot through.
  const obstruction=traceBullet(shoulder,barrel.normalize(),barrelLength,targets);
  if(obstruction.impact!=='air')return {...obstruction,view};
  const direction=point.sub(muzzle);
  if(direction.lengthSq()<.0001||direction.dot(view)<=0)direction.copy(view);
  direction.normalize();
  return {...traceBullet(muzzle,direction,range,targets),view};
}
function impactParticles(point,enemyHit){
  // v1.3: sparks are additive and short-lived; a puff of smoke is normal-blended
  // and slower, so the two read as different materials instead of one grey blob.
  for(let i=0;i<(enemyHit?7:4);i++){
    const sprite=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,
      color:enemyHit&&i>1?'#8d3a2c':'#e8c98a',transparent:true,depthWrite:false,
      blending:THREE.AdditiveBlending}));
    sprite.position.copy(point);sprite.scale.setScalar(rand(.07,.19));scene.add(sprite);
    effects.push({object:sprite,life:.26,max:.26,type:'spark',
      velocity:new V(rand(-2.1,2.1),rand(.4,2.4),rand(-1.6,1.6))});
  }
  // Smoke: one soft puff that expands and fades, tinted by what was hit.
  const smoke=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,
    color:enemyHit?'#4a3a34':'#8a8578',transparent:true,opacity:.5,depthWrite:false}));
  smoke.position.copy(point);smoke.scale.setScalar(.22);scene.add(smoke);
  effects.push({object:smoke,life:.7,max:.7,type:'smoke',grow:1.9,
    velocity:new V(rand(-.2,.2),rand(.3,.7),rand(-.2,.2))});
}
/**
 * Muzzle blast: a bright core, a short-lived cone of light on the barrel, and a
 * wisp of smoke that drifts up. Called once per shot, not per pellet.
 */
function muzzleBlast(){
  const origin=player.muzzle.getWorldPosition(new V());
  const core=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:'#fff0c4',
    transparent:true,blending:THREE.AdditiveBlending,depthWrite:false}));
  core.position.copy(origin);core.scale.setScalar(.55);scene.add(core);
  effects.push({object:core,life:.07,max:.07,type:'flash'});
  const smoke=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTexture,color:'#9a958a',
    transparent:true,opacity:.34,depthWrite:false}));
  smoke.position.copy(origin);smoke.scale.setScalar(.2);scene.add(smoke);
  effects.push({object:smoke,life:.55,max:.55,type:'smoke',grow:1.5,
    velocity:new V(rand(-.15,.15),rand(.25,.5),rand(-.15,.15))});
}
function shoot(isTap=false){
  if(phase!=='playing'||(shotCooldown>0&&!tapBypassesCooldown(activeWeapon.id,isTap))||reloadTime>0||shoveTime>0)return;
  if(ammo<=0){if(reserve>0)reload();else{shotCooldown=.7;toast('Sin munición. Busca cajas o evita a los infectados.',2);}return;}
  const view=camera.getWorldDirection(new V());
  player.group.rotation.y=Math.atan2(view.x,view.z);
  updatePlayerPose(0,true);
  const pellets=Math.max(1,activeWeapon.pellets||1);
  const spread=activeWeapon.spread||0;
  let primary=null,anyHit=false,anyWorld=false;
  for(let pellet=0;pellet<pellets;pellet++){
    // Each pellet is an independent ray; the first one is the reticle shot.
    if(spread>0&&pellet>0){
      const jitter=new V((Math.random()-.5)*spread,(Math.random()-.5)*spread,(Math.random()-.5)*spread);
      camera.rotateOnWorldAxis(new V(0,1,0),jitter.x);
      camera.rotateX(jitter.y);
      camera.updateMatrixWorld();
    }
    const shot=traceShot(),{from,end,target}=shot;
    if(!primary)primary=shot;
    const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints([from,end]),new THREE.LineBasicMaterial({color:'#ffe4a7',transparent:true,opacity:.9}));scene.add(line);effects.push({object:line,life:.07,max:.07,type:'line'});
    if(target){
      anyHit=true;
      const firstHit=target.hp===target.maxHp;
      const damage=Math.round(activeWeapon.damage*runDamageScale);
      target.hp-=damage;target.stagger=.22;
      // White one-frame flash on the struck enemy, plus a flinch pose.
      target.flash=.09;
      target.hitFlinch=HIT_FLINCH;
      feedback.hitmarker(target.hp<=0?'kill':'body');
      feedback.damageNumber(end,damage,camera,target.hp<=0?'kill':'body');
      feedback.kick(target.hp<=0?3:2.2);
      if(firstHit&&target.hp>0&&(target.kind==='resistant'||target.kind==='brute')){
        toast(`${ENEMY_TYPES[target.kind].name}: aguanta más disparos. Evítalo si puedes.`,2.5);
      }
      moveEntity(target.group.position,shot.direction.x*.13,shot.direction.z*.13,.3);
      impactParticles(end,true);
      if(target.hp<=0){target.dead=true;target.fade=0;kills++;}
    }else if(shot.impact==='world'){anyWorld=true;impactParticles(end,false);}
  }
  const shot0=primary;
  lastShot={from:shot0.from.toArray(),end:shot0.end.toArray(),direction:shot0.direction.toArray(),
    cameraDirection:shot0.view.toArray(),impact:anyHit?'enemy':anyWorld?'world':'air',
    enemyId:null,pellets};
  ammo--;shotCooldown=activeWeapon.cooldown;recoil=activeWeapon.recoil*(aiming?.69:1);muzzleTime=.065;player.muzzle.visible=true;
  muzzleBlast();
  // v1.2: burst weapons queue their extra rounds instead of firing them in the
  // same frame, so the recoil and the sound land as three distinct shots.
  if((activeWeapon.burst||1)>1&&burstLeft===0){burstLeft=(activeWeapon.burst||1)-1;burstTimer=activeWeapon.burstDelay||.07;}
  sound('shot',0,activeWeapon.id);makeNoise(activeWeapon.noise);
  if(anyHit)sound('hit',0);else if(anyWorld)sound('world',0);
  if(ammo===0&&reserve>0)reload();
  updateHUD();
}
function updateHUD(force=false){
  if(force||health!==lastHealth){$('health').textContent=Math.max(0,Math.ceil(health));$('health-bar').style.width=`${Math.max(0,health/runMaxHealth*100)}%`;$('health-bar').style.background=health<runMaxHealth*.3?'#ef765e':'';$('health-max').textContent=` / ${runMaxHealth}`;lastHealth=health;}
  if(force||ammo!==lastAmmo){$('ammo').textContent=String(ammo).padStart(2,'0');lastAmmo=ammo;}
  $('reserve').textContent=String(reserve).padStart(3,'0');
  if(force||kills!==lastKills){$('kills').textContent=String(kills).padStart(2,'0');lastKills=kills;}
  const stage=missionProgress.stage;
  if(force||stage!==lastStage){
    const target=missionTarget(missionProgress);
    $('objective').textContent=stage==='complete'?'Zona de extracción alcanzada':target?target.label:'Alcanza la zona de extracción';
    lastStage=stage;
  }
  const target=missionTarget(missionProgress);
  if(target){
    const p=player.group.position,dx=target.x-p.x,dz=target.z-p.z;
    const distance=Math.ceil(Math.hypot(dx,dz));
    if(force||distance!==lastDistance){$('mission-distance').textContent=`${distance} m`;lastDistance=distance;}
    const bearing=Math.atan2(dx,-dz)-yaw;
    $('mission-arrow').style.transform=`rotate(${bearing}rad)`;
  }
  const danger=enemies.some(e=>!e.dead&&e.mode==='chase')?'TE HAN VISTO':enemies.some(e=>!e.dead&&e.alert>0)?'TE ESTÁN BUSCANDO':'AVANZA CON CUIDADO';
  if(force||danger!==lastThreat){$('mission-danger').textContent=danger;$('mission-danger').classList.toggle('danger',danger==='TE HAN VISTO');lastThreat=danger;}
  $('ammo').classList.toggle('low-ammo',ammo+reserve<=4);
  interaction=phase==='playing'?nearbyInteraction(player.group.position,missionProgress):null;
  $('interact').classList.toggle('hidden',!interaction);
  if(interaction){$('interact-label').textContent=interaction.kind==='health'&&health>=runMaxHealth?'Salud completa · deja el botiquín':interaction.label;$('interact').disabled=interaction.kind==='health'&&health>=runMaxHealth;}

  $('reload').classList.toggle('reloading',reloadTime>0);
  $('reload-feedback').textContent=reloadTime>0?`${reloadMode==='manual'?'MANUAL':'AUTOMÁTICA'} · ${reloadTime.toFixed(1)} s`:'RECARGA ANTES DE VACIAR';
  $('shove').disabled=shoveCooldown>0;
  $('shove-label').textContent=shoveCooldown>0?`${shoveCooldown.toFixed(1)} s`:'EMPUJAR';
  $('shove').setAttribute('aria-label',shoveCooldown>0?`Empujón recuperándose: ${Math.ceil(shoveCooldown)} segundos`:'Empujar al infectado de delante');
  const pending=waveProgress.pending;
  const waveText=pending?`${waveProgress.next}/${WAVES.length} · ${Math.max(0,Math.ceil(pending.dueAt-gameTime))} s`:`${waveProgress.arrived.length}/${WAVES.length}`;
  if($('wave-count').textContent!==waveText)$('wave-count').textContent=waveText;
  $('wave-label').textContent=pending?'EN CAMINO':'OLEADAS';
  $('wave-status').classList.toggle('incoming',Boolean(pending));
}
function endGame(victory){
  const restartBtnText = document.getElementById('restart-text');
  if(restartBtnText) restartBtnText.textContent = victory ? 'CONTINUAR' : 'REINTENTAR';
  if(phase!=='playing'||(victory&&missionProgress.stage!=='complete'))return;
  phase='end';
  audioEngine.stopAmbience();
  if(victory){refreshProfile();const settled=rewardExtraction(profile,currentRunId,{supplies:missionProgress.supplies});lastRunAward=settled.awarded;commitProfile(settled.profile);}else lastRunAward=0;
  $('end-reward').textContent=victory?`+${lastRunAward} CRÉDITOS${missionProgress.supplies?` · incluye +${SUPPLIES_BONUS} por suministros`:''}`:'Sin recompensa · tus créditos anteriores se conservan';
  updateProfileUI();resetInputs();$('end').classList.remove('hidden');
  $('interact').classList.add('hidden');
  $('end-title').textContent=victory?'SALISTE DEL DISTRITO':'EL DISTRITO TE RECLAMÓ';
  const routeName=missionProgress.route?(ROUTES[missionProgress.route]||ROUTES.short).name:'sin ruta';
  $('end-detail').textContent=`${kills} infectados eliminados · ${Math.floor(gameTime/60)}:${String(Math.floor(gameTime%60)).padStart(2,'0')} de supervivencia · ${routeName}${victory?` · ${ammo+reserve} balas restantes al salir`:''}`;
  $('objective').textContent=victory?'Extracción completada':'Sin señal';
}
function pause(){if(joystickEditor.isOpen()){closeJoystickEditor();return;}if(phase==='playing'){phase='paused';$('paused').classList.remove('hidden');resetInputs();$('interact').classList.add('hidden');}else if(phase==='paused'){phase='playing';$('paused').classList.add('hidden');document.activeElement?.blur();}}
function collides(x,z,r=.38){if(x<-10.7||x>10.7||z<-92||z>78)return true;return obstacles.some(o=>Math.abs(x-o.x)<o.rx+r&&Math.abs(z-o.z)<o.rz+r);}
function moveEntity(position,dx,dz,r=.38){if(!collides(position.x+dx,position.z,r))position.x+=dx;if(!collides(position.x,position.z+dz,r))position.z+=dz;}
function movePlayer(position,dx,dz){
  const free=(x,z)=>!collides(x,z)&&!enemies.some(e=>!e.dead&&Math.hypot(x-e.group.position.x,z-e.group.position.z)<.72);
  if(free(position.x+dx,position.z))position.x+=dx;
  if(free(position.x,position.z+dz))position.z+=dz;
}

let isFpsCamera = false;
let isCrouched = false;
let isSprinting = false;
let isFlashlightOn = true;
let currentEnv = 'night';
const CHECKPOINT_KEY = 'distrito09.checkpoint.v2';

function turn180(){
  yaw = THREE.MathUtils.euclideanModulo(yaw + Math.PI, Math.PI * 2);
  applyLook(0, 0);
  updateCamera(0, true);
  toast('Giro rápido 180°', 0.8);
}
function toggleFpsCamera(){
  isFpsCamera = !isFpsCamera;
  player.group.visible = !isFpsCamera;
  document.getElementById('btn-cam')?.classList.toggle('active', isFpsCamera);
  document.getElementById('btn-cam-view')?.classList.toggle('active', isFpsCamera);
  toast(isFpsCamera ? 'Cámara: Primera Persona (FPS)' : 'Cámara: Tercera Persona (Detrás del hombro)', 1.5);
}
function toggleCrouch(){
  isCrouched = !isCrouched;
  if (isCrouched && isSprinting) isSprinting = false;
  document.getElementById('btn-crouch')?.classList.toggle('active', isCrouched);
  const crouchSpan = document.getElementById('crouch-label') || document.getElementById('btn-crouch')?.querySelector('span');
  if (crouchSpan) crouchSpan.textContent = isCrouched ? 'DE PIE' : 'AGACHARSE';
  toast(isCrouched ? 'Agachado (Sigilo y silencio de pasos)' : 'De pie', 1.2);
}
function toggleSprint(){
  isSprinting = !isSprinting;
  if (isSprinting && isCrouched) isCrouched = false;
  document.getElementById('btn-sprint')?.classList.toggle('active', isSprinting);
  toast(isSprinting ? 'Sprint táctico: MODO CORRER' : 'Sprint: MODO CAMINAR', 1.0);
}
function toggleFlashlight(){
  isFlashlightOn = !isFlashlightOn;
  toast(isFlashlightOn ? 'Linterna táctica: ENCENDIDA' : 'Linterna: APAGADA', 1.0);
  if (torch) torch.intensity = isFlashlightOn ? (currentEnv.startsWith('day') ? 0.8 : 2.8) : 0;
  document.getElementById('btn-flashlight')?.classList.toggle('active', isFlashlightOn);
}
function cycleWeather(){
  const modes = ['night', 'night_rain', 'day', 'day_rain'];
  const nextIdx = (modes.indexOf(currentEnv) + 1) % modes.length;
  currentEnv = modes[nextIdx];
  const badge = document.getElementById('env-badge');
  if (currentEnv === 'day') {
    scene.background.set('#6f8e9c');
    if (scene.fog) scene.fog.color.set('#6f8e9c');
    if (lighting?.moon) { lighting.moon.color.set('#fff2db'); lighting.moon.intensity = 2.2; }
    if (rainField && rainField.lines) rainField.lines.visible = false;
    applyWetSurfaces({ materials: [M.asphalt, M.pavement], wet: false });
    if (badge) badge.textContent = 'CLIMA: DÍA';
    toast('Clima: Día despejado · Visibilidad alta', 1.5);
  } else if (currentEnv === 'day_rain') {
    scene.background.set('#52656d');
    if (scene.fog) scene.fog.color.set('#52656d');
    if (lighting?.moon) { lighting.moon.color.set('#cddde5'); lighting.moon.intensity = 1.4; }
    if (rainField && rainField.lines) rainField.lines.visible = true;
    applyWetSurfaces({ materials: [M.asphalt, M.pavement], wet: true });
    if (badge) badge.textContent = 'CLIMA: LLUVIA DÍA';
    toast('Clima: Lluvia diurna · Asfalto mojado', 1.5);
  } else if (currentEnv === 'night') {
    scene.background.set('#101822');
    if (scene.fog) scene.fog.color.set('#101822');
    if (lighting?.moon) { lighting.moon.color.set('#95b7c7'); lighting.moon.intensity = 1.1; }
    if (rainField && rainField.lines) rainField.lines.visible = false;
    applyWetSurfaces({ materials: [M.asphalt, M.pavement], wet: false });
    if (badge) badge.textContent = 'CLIMA: NOCHE';
    toast('Clima: Noche cerrada · Niebla densa', 1.5);
  } else if (currentEnv === 'night_rain') {
    scene.background.set('#0b1016');
    if (scene.fog) scene.fog.color.set('#0b1016');
    if (lighting?.moon) { lighting.moon.color.set('#8aa8b8'); lighting.moon.intensity = 0.8; }
    if (rainField && rainField.lines) rainField.lines.visible = true;
    applyWetSurfaces({ materials: [M.asphalt, M.pavement], wet: true });
    if (badge) badge.textContent = 'CLIMA: TORMENTA';
    toast('Clima: Tormenta nocturna · Lluvia y viento', 1.5);
  }
  if (torch) torch.intensity = isFlashlightOn ? (currentEnv.startsWith('day') ? 0.8 : 2.8) : 0;
}
function saveCheckpoint(){
  try {
    const cp = {
      x: player.group.position.x,
      z: player.group.position.z,
      hp: health,
      ammo,
      reserve,
      kills,
      time: gameTime,
      stage: missionProgress?.stage || 'intro'
    };
    localStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp));
  } catch(_) {}
}
function loadCheckpoint(){
  try {
    const str = localStorage.getItem(CHECKPOINT_KEY);
    return str ? JSON.parse(str) : null;
  } catch(_) { return null; }
}

const cameraTarget=new V();
const cameraForward=new V(),cameraRight=new V(),cameraPivot=new V(),desiredCamera=new V();
function updateCamera(dt,snap=false){
  const p=player.group.position,dir=aimDirection(yaw,pitch);
  cameraForward.set(dir.x,dir.y,dir.z);cameraRight.set(Math.cos(yaw),0,Math.sin(yaw));
  if(isFpsCamera){
    player.group.visible=false;
    const eyeHeight=isCrouched?0.95:1.55;
    desiredCamera.copy(p);
    desiredCamera.y+=eyeHeight;
    desiredCamera.addScaledVector(cameraForward,0.24);
    if(snap)camera.position.copy(desiredCamera);
    else camera.position.lerp(desiredCamera,1-Math.exp(-dt*20));
    cameraTarget.copy(camera.position).addScaledVector(cameraForward,12);
    cameraTarget.y+=recoil*.8;
    camera.lookAt(cameraTarget);camera.updateMatrixWorld();
    return;
  }
  player.group.visible=true;
  cameraPivot.copy(p);cameraPivot.y+=isCrouched?0.92:1.48;
  const downClearance=.6*clamp((-pitch-.6)/.6,0,1);
  const distance=3.35-.75*aimBlend;
  const shoulder=.78+.16*aimBlend+downClearance;

  desiredCamera.copy(cameraPivot)
    .addScaledVector(cameraForward,-distance)
    .addScaledVector(cameraRight,shoulder);
  desiredCamera.y=Math.max(p.y+.35,desiredCamera.y+.22+.06*aimBlend+recoil*.35);

  const camOffset=desiredCamera.clone().sub(cameraPivot);
  const fullDist=camOffset.length();
  let actualDist=fullDist;

  if(fullDist>0.001){
    camOffset.normalize();
    shotRay.set(cameraPivot,camOffset);
    shotRay.near=0.04;
    shotRay.far=fullDist;
    const solids=shotBlockers.filter(visibleInWorld);
    const hits=shotRay.intersectObjects(solids,false);
    if(hits.length>0){
      actualDist=Math.min(actualDist,Math.max(0.38,hits[0].distance-0.32));
    }
  }

  const testPos=cameraPivot.clone().addScaledVector(camOffset,actualDist);
  testPos.x=clamp(testPos.x,-10.4,10.4);
  testPos.z=clamp(testPos.z,-93.0,76.5);
  testPos.y=Math.max(p.y+.35,testPos.y);
  desiredCamera.copy(testPos);

  const curDist=camera.position.distanceTo(cameraPivot);
  const lerpFactor=actualDist<curDist?(1-Math.exp(-dt*25)):(1-Math.exp(-dt*9));
  if(snap)camera.position.copy(desiredCamera);
  else camera.position.lerp(desiredCamera,lerpFactor);

  cameraTarget.copy(cameraPivot).addScaledVector(cameraForward,12).addScaledVector(cameraRight,shoulder*.55);
  cameraTarget.y+=recoil*.8;
  camera.lookAt(cameraTarget);
  camera.updateMatrixWorld();
}
function updatePlayerPose(dt,snap=false){
  const view=camera.getWorldDirection(cameraForward);
  const viewPitch=Math.asin(clamp(view.y,-1,1));
  const localYaw=THREE.MathUtils.euclideanModulo(Math.atan2(view.x,view.z)-player.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;
  const progress=reloadTime>0?1-reloadTime/Math.max(.001,reloadTotal):1;
  const push=shoveTime>0?Math.sin((1-shoveTime/COMBAT.shoveAnimation)*Math.PI):0;
  const reloadTarget=reloadTime>0?Math.max(0,Math.min(1,progress*6,(1-progress)*5)):0;
  reloadBlend=snap?reloadTarget:THREE.MathUtils.lerp(reloadBlend,reloadTarget,1-Math.exp(-dt*18));
  // v1.2: reload and weapon-swap are one pose solver, so the two motions
  // compose instead of fighting over the same rotations.
  const swapProgress=swapTime>0?1-swapTime/SWAP_TIME:0;
  const wp=weaponPose({reloadProgress:reloadTime>0?progress:0,swapProgress,recoil,aiming});
  const bodyPitch=viewPitch*.3*(1-reloadBlend*.4),armPitch=viewPitch-bodyPitch;
  player.upper.position.y=isCrouched?.68:(1.49-player.group.position.y);player.group.scale.y=isCrouched?0.82:1.0;
  player.upper.rotation.order='YXZ';player.upper.rotation.x=-bodyPitch+push*.12;
  player.upper.rotation.y=clamp(localYaw,-.8,.8);
  player.arms[0].rotation.x=-armPitch+wp.armPitch-recoil*.7;
  player.arms[1].rotation.x=-armPitch+wp.armPitch*.95-recoil*.55-push*.65;
  player.arms[1].rotation.z=wp.armRoll;
  player.gunRig.rotation.x=-armPitch+wp.gunPitch+push*.4;
  player.gunRig.rotation.z=wp.gunRoll;
  player.gun.rotation.x=-recoil*1.3;
  player.gun.position.y=wp.gunY;
  player.gun.position.z=.57+wp.gunZ;
}
function tick(dt,t){
  const p=player.group.position;
  missionWorld.update({stage:missionProgress.stage,time:t,supplies:missionProgress.supplies,playerPosition:p,collected:missionProgress.collected});
  // v1.3: atmosphere follows the player — fog sheets drift, dust recycles in a
  // box around the camera, and the shadow camera tracks the player.
  fogLayers.update(p,t);
  dustField.update(p,t,dt);
  lighting.update(p);
  // v1.4: rain recycles around the player, smoke drifts up from the wrecks.
  rainField.update(p,dt);
  smokePlumes.update(t);
  for(const m of mist)m.position.x+=Math.sin(t*.12+m.position.z)*dt*.04;
  rain.position.set(p.x,0,p.z);const a=rain.geometry.attributes.position.array;
  for(let i=0;i<rainCount;i++){const j=i*6;a[j+1]-=dt*11;a[j+4]-=dt*11;if(a[j+1]<0){a[j+1]+=20;a[j+4]+=20;}}rain.geometry.attributes.position.needsUpdate=true;
  for(let i=effects.length-1;i>=0;i--){const e=effects[i];e.life-=dt;if(e.velocity){e.object.position.addScaledVector(e.velocity,dt);e.velocity.y-=dt*4;}
    // v1.3: smoke expands as it fades, so a puff reads as volume rather than a
    // shrinking dot. Sparks keep their size and just fade.
    if(e.grow){const t=1-clamp(e.life/e.max,0,1);e.object.scale.setScalar(.2+t*e.grow);}
    e.object.material.opacity=clamp(e.life/e.max,0,1)*(e.type==='smoke'?.5:1);
    if(e.life<=0){scene.remove(e.object);if(e.type==='line')e.object.geometry.dispose();e.object.material.dispose();effects.splice(i,1);}}
  if(phase==='intro'){
    camera.position.set(8+Math.sin(t*.12)*2,5.8,65);camera.lookAt(-1,1.8,32);player.group.visible=true;return;
  }
  if(phase!=='playing')return;
  aimBlend+=((aiming?1:0)-aimBlend)*(1-Math.exp(-dt*12));
  const fov=58-14*aimBlend;
  if(Math.abs(camera.fov-fov)>.005){camera.fov=fov;camera.updateProjectionMatrix();}
  gameTime+=dt;invulnerable=Math.max(0,invulnerable-dt);shotCooldown=Math.max(0,shotCooldown-dt);muzzleTime-=dt;player.muzzle.visible=muzzleTime>0;recoil*=Math.exp(-dt*15);
  shoveCooldown=Math.max(0,shoveCooldown-dt);shoveTime=Math.max(0,shoveTime-dt);
  swapTime=Math.max(0,swapTime-dt);
  // Burst queue: the remaining rounds of a burst fire on their own timer.
  if(burstLeft>0){
    burstTimer-=dt;
    if(burstTimer<=0&&ammo>0&&reloadTime===0&&shoveTime===0){
      burstLeft--;burstTimer=activeWeapon.burstDelay||.07;
      shotCooldown=0;shoot();
    }else if(ammo<=0||reloadTime>0){burstLeft=0;}
  }
  if(statusTime>0){statusTime-=dt;if(statusTime<=0)$('status').classList.remove('visible');}
  if(reloadTime>0){reloadTime=Math.max(0,reloadTime-dt);if(reloadTime===0){const count=Math.min(activeWeapon.magazine-ammo,reserve);ammo+=count;reserve-=count;reloadMode=null;toast('Arma lista',.9);}}
  if(ammo===0&&reserve>0&&reloadTime===0&&shoveTime===0)reload();

  let mx=stickX+(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
  let my=-stickY+(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0);
  const norm=Math.hypot(mx,my);if(norm>1){mx/=norm;my/=norm;}
  const forward=new V(Math.sin(yaw),0,-Math.cos(yaw)),right=new V(Math.cos(yaw),0,Math.sin(yaw));
  const movement=forward.clone().multiplyScalar(my).addScaledVector(right,mx);
  const moving=movement.length()>.05;
  const sprintWanted=(isSprinting||keys.has('ShiftLeft')||keys.has('ShiftRight'))&&ammo>0&&!aiming&&!isCrouched;
  let speed=(sprintWanted?5.2:3.15)*(my<-.3?.8:1)*(aiming?.65:1)*runSpeedScale;
  if(isCrouched) speed*=.50;
  movePlayer(p,movement.x*speed*dt,movement.z*speed*dt);
  if(moving){
    walkTime+=dt*(isCrouched?4.2:(sprintWanted?11.5:7.4));
    stepTime-=dt;
    if(stepTime<=0){
      if(!isCrouched){sound('step',0,aiming?.55:1);if(sprintWanted)makeNoise(18);}
      stepTime=sprintWanted?.24:(isCrouched?.62:.42);
    }
  }else stepTime=0;
  const desired=Math.atan2(forward.x,forward.z);
  const angle=THREE.MathUtils.euclideanModulo(desired-player.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;
  player.group.rotation.y+=angle*Math.min(1,dt*16);
  characterVisuals.animate(player,{phase:walkTime,moving,dt});
  player.group.position.y=(Math.abs(p.x)>9?.10:0)+(moving?Math.abs(Math.sin(walkTime))*.018:0);
  groundCharacter(player);

  updateWaves();
  // Falling zombies: the director stages a drop, then gravity runs in the loop.
  const drop=fallDirector.update({playerZ:p.z,time:gameTime,active:phase==='playing',
    alive:enemies.filter(e=>e.falling).length});
  if(drop)spawnFalling(drop);
  updateFalling(dt);
  for(let i=enemies.length-1;i>=0;i--){
    const e=enemies[i];
    if(e.dead){
      if(e.shadow)e.shadow.visible=false;
      e.fade+=dt;
      // A corpse from a fall stays on the ground as scenery; a shot-down body
      // still sinks and is recycled so the street does not fill with meshes.
      if(!e.corpse)e.group.rotation.z=THREE.MathUtils.lerp(e.group.rotation.z,1.55,Math.min(1,dt*6));
      if(!e.corpse)e.group.position.y=-Math.min(.6,e.fade*.16);
      if(e.fade>(e.corpse?26:4.5)){scene.remove(e.group);enemies.splice(i,1);}
      continue;
    }
    if(e.falling){e.group.visible=true;continue;}
    const toPlayer=p.clone().sub(e.group.position);toPlayer.y=0;const dist=toPlayer.length();
    e.group.visible=dist<36;
    // v1.4: LOD is now a decision about *which list the body goes into*, not
    // about toggling nine meshes. Near bodies are drawn by the instancer (9
    // draws per archetype); far ones fall back to the single-draw merged body.
    // The threshold comes from the graphics profile, so Ultra keeps limbs
    // further out and Bajo collapses sooner.
    const near=dist<=quality.lodDistance;
    // v1.4: the instancer owns `distant.visible` now — it hides the per-zombie
    // merged mesh and draws the far LOD from a shared batch. Re-enabling it here
    // would draw every far zombie twice (once per-mesh, once in the batch).
    e.nearLod=near;
    // --- v1.4 perception: cone + occlusion + hearing + memory --------------
    // v1.3 used `dist<17 && dot>.15`, a 160° cone with no occlusion test: a
    // zombie facing a wall saw you through it. Now the cone is 70°, the sight
    // line is tested against the same colliders the bullets use, and a gunshot
    // is heard by radius even when the shooter is behind the zombie.
    const seen=visionConfidence({from:e.group.position,facing:e.group.rotation.y,to:p,
      occluded:(a,b)=>lineBlocked(a,b)});
    const soundDist=sprintWanted?22:(isCrouched?2.5:9);
    const hearsPlayer=dist<soundDist&&(sprintWanted||!isCrouched)&&!lineBlocked(e.group.position,p);
    const heard=(e.heardNoise>0||hearsPlayer)?hearingConfidence({from:e.group.position,to:p,strength:hearsPlayer?Math.max(e.heardNoise||0,14):e.heardNoise}):0;
    if(seen>0){e.lastKnown.copy(p);e.memoryAge=0;}
    else e.memoryAge=(e.memoryAge??99)+dt;
    const stepped=stepAlert({alert:e.alert||0,seen,heard,dt,memoryAge:e.memoryAge});
    e.alert=stepped.alert;e.mode=stepped.mode;
    // A pack reacts as a pack: one that sees you wakes the ones beside it.
    if(seen>0&&e.alert>=PERCEPTION.chaseThreshold){
      for(const other of enemies){
        if(other===e||other.dead||other.falling)continue;
        const gap=other.group.position.distanceTo(e.group.position);
        if(gap<9&&(other.alert||0)<e.alert*.5){
          other.alert=Math.min(1,(other.alert||0)+shareAlert({alert:e.alert,neighbours:[{distance:gap}]}));
          other.lastKnown.copy(p);other.memoryAge=0;
        }
      }
    }
    // Noise decays: a shot is a moment, not a permanent beacon.
    if(e.heardNoise>0)e.heardNoise=Math.max(0,e.heardNoise-dt*.55);
    e.wanderTimer-=dt;
    if(e.wanderTimer<=0){e.wander.copy(e.home).add(new V(rand(-2,2),0,rand(-2.5,2.5)));e.wanderTimer=rand(4,8);}
    // --- v1.4 roles: ambushers burst out, cowards flee and come back --------
    const role=ROLES[e.role||e.kind]||ROLES.shambler;
    if(role.ambush&&e.waiting){
      const burst=ambushTrigger({role:e.role||e.kind,waiting:e.waiting,position:e.group.position,
        player:p,facing:e.group.rotation.y,triggerRange:7,time:gameTime,cooldown:e.ambushCooldown||0});
      if(burst){
        e.waiting=false;e.alert=1;e.mode='chase';e.lastKnown.copy(p);e.memoryAge=0;
        e.stagger=0;e.ambushCooldown=6;
        toast('¡Salieron de los edificios!',2);
        sound('growl',panFor(e.group.position),5);
      }
    }
    if(e.ambushCooldown>0)e.ambushCooldown=Math.max(0,e.ambushCooldown-dt);
    const fleeMode=cowardMode({role:e.role||e.kind,hp:e.hp,maxHp:e.maxHp,
      fleeing:e.fleeing,fleeUntil:e.fleeUntil||0,time:gameTime});
    if(fleeMode==='flee'&&!e.fleeing){e.fleeing=true;e.fleeUntil=gameTime+4.5;}
    if(e.fleeing&&gameTime>=e.fleeUntil){e.fleeing=false;e.alert=Math.max(e.alert,.6);}
    const behaviour=behaviourTarget({mode:e.fleeing?'idle':e.mode,position:e.group.position,
      lastKnown:e.lastKnown,home:e.home,wander:e.wander,flank:role.flank,time:gameTime});
    // A fleeing coward runs *away* from the player instead of toward it.
    const target=e.fleeing
      ?new V(e.group.position.x*2-p.x,0,e.group.position.z*2-p.z)
      :new V(behaviour.x,0,behaviour.z);
    const dir=target.clone().sub(e.group.position);dir.y=0;const destinationDistance=dir.length();dir.normalize();
    const separation=new V();
    for(const other of enemies){
      if(other===e||other.dead)continue;
      const dx=e.group.position.x-other.group.position.x,dz=e.group.position.z-other.group.position.z,n=Math.hypot(dx,dz);
      if(n<.9&&n>.01){const k=(.9-n)/n*.8;separation.x+=dx*k;separation.z+=dz*k;}
    }
    e.stagger=Math.max(0,e.stagger-dt);
    // An enraged faller calms down when its window closes: speed and aura go.
    if(e.buff&&e.buff.kind==='enraged'&&!buffActive(e.buff,gameTime)){
      e.speed=e.kind==='runner'?2.05:1.15;e.damageMul=1;e.buff=null;
      if(e.aura){e.group.remove(e.aura);e.aura.geometry.dispose();e.aura.material.dispose();e.aura=null;}
    }
    if(e.aura)e.aura.material.opacity=.35+.25*Math.sin(gameTime*7);
    // v1.4: the impact flash is a per-instance tint, not a material emissive.
    // The archetype shares one material across every body, so setting emissive
    // here would flash all of them at once — the instancer lifts only the struck
    // instance toward white instead.
    if(e.flash>0){
      e.flash=Math.max(0,e.flash-dt);
      e.flashTint=e.flash>0?Math.min(1,e.flash/.09):0;
    }else if(e.flashTint)e.flashTint=0;
    // v1.4: the state is resolved *before* movement, because whether a body may
    // translate at all is a property of its state. v1.3 moved first and posed
    // after, so a prone crawler walked at full standing speed and a corpse could
    // still be pushed around.
    const zState=resolveZombieState({falling:e.falling,gettingUp:e.getup>0,prone:e.prone,dead:e.dead,
      moving:destinationDistance>.55,running:e.kind==='runner'||(e.buff&&e.buff.kind==='enraged'),
      attacking:e.attackSwing>0,hit:e.hitFlinch>0});
    const locomotion=locomotionFor(zState);
    const walking=locomotion.moves&&destinationDistance>.55&&(dist>1||e.alert===0);
    if(walking){
      const step=dir.clone().add(separation).normalize()
        .multiplyScalar(e.speed*locomotion.speedMul*dt*(e.alert>0?1:.28)*(e.stagger>0?.18:1));
      const before=e.group.position.clone();
      moveEntity(e.group.position,step.x,step.z,locomotion.radius);
      if(e.group.position.distanceToSquared(before)<.00001)moveEntity(e.group.position,(e.group.position.x>0?-1:1)*dt*e.speed,step.z,locomotion.radius);
      const desired=Math.atan2(dir.x,dir.z);const turn=THREE.MathUtils.euclideanModulo(desired-e.group.rotation.y+Math.PI,Math.PI*2)-Math.PI;
      e.group.rotation.y+=turn*Math.min(1,dt*4);
      e.anim+=dt*e.speed*(e.alert>0?5.5:2.2);
    }
    // v1.4: a body that has ended up inside a collider (a spawn, a shove, a
    // landing) is pushed out instead of being left to walk through it.
    if(!e.falling){
      const fixed=separateFromColliders({x:e.group.position.x,z:e.group.position.z},obstacles,locomotion.radius);
      if(fixed.x!==e.group.position.x||fixed.z!==e.group.position.z){
        e.group.position.x=fixed.x;e.group.position.z=fixed.z;
      }
    }
    characterVisuals.animate(e,{phase:e.anim,moving:walking,dt});
    // v1.2: one pose solver for every zombie state (walk/run/fall/getup/crawl/
    // dead) instead of a walk cycle plus ad-hoc overrides.
    const pose=zombiePose({state:zState,phase:e.anim,progress:e.getup>0?1-e.getup/GETUP_TIME:
      e.attackSwing>0?1-e.attackSwing/ATTACK_SWING:e.hitFlinch>0?1-e.hitFlinch/HIT_FLINCH:0,
      speedScale:clamp(e.speed/2.05,0,1.5)});
    for(let i=0;i<2;i++){
      if(e.legs[i])e.legs[i].rotation.x=pose.legs[i];
      if(e.knees[i])e.knees[i].rotation.x=pose.knees[i];
      if(e.arms[i])e.arms[i].rotation.x=pose.arms[i];
    }
    if(e.torso)e.torso.rotation.z=pose.torso.z;
    if(e.head){e.head.rotation.x=pose.head.x;e.head.rotation.y=pose.head.y;}
    // v1.4: the root transform comes from one contract, which always returns an
    // explicit rotationZ. That is what stops a body that fell spinning from
    // standing up and walking on its side.
    if(!e.falling){
      const root=rootTransform({state:zState,progress:e.getup>0?1-e.getup/GETUP_TIME:0,spin:e.spin||0});
      e.group.rotation.x=root.rootPitch;
      e.group.rotation.z=root.rotationZ;
      e.group.position.y=settleOnGround({x:e.group.position.x,rootY:root.rootY,state:zState});
    }
    if(e.getup>0)e.getup=Math.max(0,e.getup-dt);
    // v1.3: the lunge and the flinch are one-shot timers, so the pose solver can
    // interpolate them and the loop stays free of pose logic.
    if(e.attackSwing>0)e.attackSwing=Math.max(0,e.attackSwing-dt);
    if(e.hitFlinch>0)e.hitFlinch=Math.max(0,e.hitFlinch-dt);
    groundCharacter(e);
    e.attack-=dt;
    if(dist<1.55&&e.attack<=0&&e.stagger<=0&&invulnerable<=0&&!lineBlocked(e.group.position,p)){
      // The lunge plays before the damage lands, so the hit has a visible cause.
      e.attackSwing=ATTACK_SWING;
      health-=Math.round(12*(e.damageMul||1));e.attack=1.15;invulnerable=.6;damageFade=.55;sound('hurt',panFor(e.group.position));feedback.kick(3);
      if(health<=0){health=0;endGame(false);break;}
    }
  }
  growlTime-=dt;
  if(growlTime<=0){
    const near=enemies.filter(e=>!e.dead&&e.alert>0&&e.group.position.distanceTo(p)<14);
    if(near.length){
      // Pan by the nearest threat so a growl from behind is audible behind you.
      const closest=near.reduce((a,b)=>a.group.position.distanceTo(p)<b.group.position.distanceTo(p)?a:b);
      sound('growl',panFor(closest.group.position),closest.group.position.distanceTo(p));
    }
    growlTime=rand(3,6);
  }
  damageFade=Math.max(0,damageFade-dt);$('damage').style.opacity=damageFade;
  updateCamera(dt);updatePlayerPose(dt);
  // v1.2: one recycled street lamp follows the player; the blob field rebuilds
  // every instance matrix in a single pass.
  streetLighting.update(p,dt);
  blobField.update();
  // Screen-space feedback: hitmarker decay, floating numbers, camera shake.
  const shakeOffset=feedback.update(dt);
  canvas.style.transform=shakeOffset.x||shakeOffset.y?`translate(${shakeOffset.x.toFixed(1)}px,${shakeOffset.y.toFixed(1)}px)`:'';
  // Shooting now uses this frame's camera, not last frame's horizontal heading.
  if(fireHeld||keys.has('Space'))shoot();
  torch.position.copy(p).add(new V(0,1.7,0));torch.target.position.copy(cameraTarget);
  torch.intensity=isFlashlightOn?(currentEnv.startsWith('day')?0.8:2.8):0;
  moon.position.set(p.x-14,28,p.z-20);moon.target.position.copy(p);
  updateHUD();
}

// Pointer events work with mouse, stylus and multitouch without scroll gestures.
$('fire').addEventListener('pointerdown',e=>{
  if(phase!=='playing'||firePointerId!==null||(e.pointerType==='mouse'&&e.button!==0))return;
  e.preventDefault();e.stopPropagation();firePointerId=e.pointerId;
  try{$('fire').setPointerCapture(e.pointerId);}catch(_){}
  fireHeld=true;shoot(true);
});
function releaseFire(e){if(e.pointerId!==firePointerId)return;firePointerId=null;fireHeld=false;}
for(const type of ['pointerup','pointercancel','lostpointercapture'])$('fire').addEventListener(type,releaseFire);
// Old WebViews can reject pointer capture: still stop when lifted elsewhere.
for(const type of ['pointerup','pointercancel'])window.addEventListener(type,releaseFire);
$('shove').addEventListener('click',shove);
$('edit-joystick').addEventListener('click',openJoystickEditor);
$('interact').addEventListener('click',interact);
$('aim').addEventListener('click',()=>setAim(!aiming));
$('look-sensitivity').addEventListener('input',updateControls);
$('aim-sensitivity').addEventListener('input',updateControls);
$('center-look').addEventListener('click',()=>{pitch=0;updateCamera(0,true);updatePlayerPose(0,true);});
$('reset-controls').addEventListener('click',()=>{controlSettings={...DEFAULT_CONTROLS};syncControls();updateControls();});
// v1.3: quality is stored and applied on the next load. Changing it live would
// mean rebuilding the shadow map, the fog stack and every texture set mid-run.
$('quality-select').addEventListener('input',()=>{
  const order=[...PROFILE_ORDER];
  const next=order[Number($('quality-select').value)]||'high';
  try{localStorage.setItem(QUALITY_KEY,next);}catch(_){}
  $('quality-value').textContent=QUALITY_PRESETS[next].label;
  $('quality-note').textContent=next===qualityId?'Ya activo.':'Se aplica al recargar la página.';
});
// v1.4: the frame cap applies live — it is a draw throttle, not a rebuild, so
// there is no reason to make the player reload for it.
$('fps-select').addEventListener('input',()=>{
  const next=FPS_OPTIONS[Number($('fps-select').value)]||60;
  fpsCap=next;frameLimiter.setFps(next);
  try{localStorage.setItem(FPS_KEY,String(next));}catch(_){}
  $('fps-value').textContent=`${next}`;
  $('quality-note').textContent=`Límite de ${next} FPS aplicado.`;
});
$('settings').addEventListener('click',()=>{if(phase==='playing')pause();});
syncControls();
$('reload').addEventListener('click',reload);$('start').addEventListener('click',start);$('restart').addEventListener('click',start);$('pause').addEventListener('click',pause);$('resume').addEventListener('click',pause);
$('sound').addEventListener('click',()=>{soundOn=!soundOn;$('sound').classList.toggle('muted',!soundOn);$('sound').setAttribute('aria-label',soundOn?'Silenciar sonido':'Activar sonido');$('sound').title=soundOn?'Sonido activado':'Sonido desactivado';});
$('fullscreen')?.addEventListener('click',()=>{if(document.fullscreenElement)document.exitFullscreen?.();else document.documentElement.requestFullscreen?.().catch(()=>{});});
let joyId=null,joyCenter={x:0,y:0};
$('joystick').addEventListener('pointerdown',e=>{if(phase!=='playing'||joyId!==null)return;e.preventDefault();e.stopPropagation();joyId=e.pointerId;$('joystick').setPointerCapture(e.pointerId);const r=$('joystick').getBoundingClientRect();joyCenter={x:r.x+r.width/2,y:r.y+r.height/2};moveJoy(e);});
function moveJoy(e){if(e.pointerId!==joyId||phase!=='playing')return;const dx=e.clientX-joyCenter.x,dy=e.clientY-joyCenter.y;const r=$('joystick').getBoundingClientRect().width*.32;const n=Math.hypot(dx,dy);const k=n>r?r/n:1;stickX=dx*k/r;stickY=dy*k/r;$('stick').style.transform=`translate(${dx*k}px,${dy*k}px)`;}
$('joystick').addEventListener('pointermove',moveJoy);
function resetJoy(e){if(e.pointerId!==joyId)return;joyId=null;stickX=stickY=0;$('stick').style.transform='translate(0px,0px)';}
$('joystick').addEventListener('pointerup',resetJoy);$('joystick').addEventListener('pointercancel',resetJoy);
$('joystick').addEventListener('lostpointercapture',resetJoy);
let lookId=null,lastLookX=0,lastLookY=0,rightAimPointer=null;
canvas.addEventListener('pointerdown',e=>{if(phase!=='playing'||lookId!==null)return;e.preventDefault();if(e.pointerType==='mouse'&&e.button===2){rightAimPointer=e.pointerId;setAim(true);}lookId=e.pointerId;lastLookX=e.clientX;lastLookY=e.clientY;canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(e.pointerId!==lookId||phase!=='playing')return;
  const next=applyLook({yaw,pitch},e.clientX-lastLookX,e.clientY-lastLookY,aiming?controlSettings.aim:controlSettings.look);
  lastLookX=e.clientX;lastLookY=e.clientY;yaw=next.yaw;pitch=next.pitch;
});
function releaseLook(e){if(e.pointerId===lookId)lookId=null;if(e.pointerId===rightAimPointer){rightAimPointer=null;setAim(false);}}
canvas.addEventListener('pointerup',releaseLook);canvas.addEventListener('pointercancel',releaseLook);
canvas.addEventListener('lostpointercapture',releaseLook);
function resetInputs(){
  fireHeld=false;firePointerId=null;stickX=stickY=0;keys.clear();lookId=joyId=rightAimPointer=null;
  setAim(false);
  $('stick').style.transform='translate(0px,0px)';
  for(const el of [canvas,$('joystick'),$('fire')]){
    // Captures naturally release on pointer-up; clearing ownership above also
    // makes delayed move/cancel events harmless after pause or restart.
    el.blur();
  }
}
window.addEventListener('keydown',e=>{
  if(e.code==='Escape'&&!e.repeat){if(joystickEditor.isOpen())closeJoystickEditor();else if(phase==='shop')closeShop();else pause();return;}
  if(phase!=='playing'||e.target.closest?.('input,select,textarea'))return;
  if(e.repeat&&!keys.has(e.code))return;
  if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.code))e.preventDefault();
  keys.add(e.code);
  if(e.code==='Space'&&!e.repeat)shoot(true);
  if(e.code==='KeyV'&&!e.repeat)shove();
  if(e.code==='KeyR')reload();
  if(e.code==='KeyC'&&!e.repeat)setAim(!aiming);
  if(e.code==='KeyQ')yaw+=.1;
  if(e.code==='KeyE')yaw-=.1;
  if(e.code==='KeyF'&&!e.repeat)interact();
});
window.addEventListener('keyup',e=>keys.delete(e.code));
window.addEventListener('blur',()=>{keys.clear();fireHeld=false;stickX=stickY=0;if(phase==='playing')pause();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&phase==='playing')pause();});
window.addEventListener('contextmenu',e=>e.preventDefault());
window.addEventListener('resize',()=>{resetInputs();applyJoystick();camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});
const joystickEditor=createJoystickEditor({container:$('joystick-editor'),onChange:value=>{joystickSettings=normalizeJoystick(value);resetInputs();applyJoystick();},onClose:closeJoystickEditor});
applyJoystick();
const shop=createShop({container:$('shop'),weapons:WEAPONS,skins:SKINS,attachments:ATTACHMENTS,attachmentsFor,onAction:shopAction,onClose:closeShop});
$('intro-shop').addEventListener('click',openShop);$('end-shop').addEventListener('click',openShop);
$('route-short').addEventListener('click',()=>chooseRoute('short'));
$('route-long').addEventListener('click',()=>chooseRoute('long'));
// First launch: put the joystick editor in front of the player instead of
// burying it in the pause menu. Only once, and only where a thumb matters.
if(touch&&!profile.firstRunDone&&!globalThis.localStorage.getItem('distrito09.joystick.v1')){
  setTimeout(()=>{if(phase==='intro'){joystickEditor.open(joystickSettings);}},600);
}
document.addEventListener('distrito-back',()=>{if(phase==='shop')closeShop();});
// Test-only hook: software-GL headless runs advance the clock ~50x slower than
// real time, so the harness needs to place the player instead of walking there.
// It exists only when the page is opened with ?debug=1.
if(new URLSearchParams(location.search).has('debug')){
  window.__debugTeleport=(x,z)=>{player.group.position.set(x,0,z);updateCamera(0,true);updateHUD(true);};
  // Reports the fog and lighting refactor so the harness can assert it.
  window.__sceneRef=scene;
  window.__stopLoop=()=>{loopRunning=false;};
  window.__startLoop=()=>{if(!loopRunning){loopRunning=true;clock.getDelta();frame();}};
  window.__fogInfo=()=>({type:scene.fog&&scene.fog.isFog?'Fog':scene.fog&&scene.fog.isFogExp2?'FogExp2':'none',
    near:scene.fog?scene.fog.near:null,far:scene.fog?scene.fog.far:null,
    lamps:streetLighting.lampCount,activeLamp:streetLighting.activeLamp,
    pointLights:scene.children.filter(o=>o.isPointLight).length,
    blobDrawCalls:blobField.drawCalls,blobCapacity:blobField.capacity});
  // Advance the simulation deterministically: software GL renders ~45x slower
  // than real time, so wall-clock waits cannot exercise movement or aiming.
  window.__debugAdvance=(seconds)=>{
    const step=1/60;
    for(let t=0;t<seconds;t+=step){elapsed+=step;tick(step,elapsed);}
    return {elapsed:gameTime,position:player.group.position.toArray(),fov:camera.fov};
  };
  // Force one drop with a chosen outcome, so all three can be asserted without
  // waiting for the director's dice. Returns the enemy id it created.
  //
  // v1.4: the outcome is no longer a free choice — it is derived from the fall
  // height. So this hook picks the height and roll that *produce* the requested
  // outcome, which keeps the old call sites honest instead of letting a test
  // assert an outcome the physics would never give.
  window.__debugForceFall=(outcome='enraged',zoneId=null)=>{
    const recipe={dead:{height:15,roll:.5},enraged:{height:8,roll:.5},crawler:{height:5,roll:.5}};
    const pick=recipe[outcome]||recipe.enraged;
    const zone={id:`forced-${outcome}`,x:0,z:player.group.position.z-12,
      height:pick.height,side:1,kind:'roof'};
    const drop={zone,outcome,fallTime:fallTime(pick.height),at:gameTime,
      index:900+fallStats.spawned,roll:pick.roll};
    const e=spawnFalling(drop);
    return e?e.id:null;
  };
  // Land every airborne enemy immediately, so a test does not have to wait.
  window.__debugLandAll=()=>{
    for(const e of enemies)if(e.falling)landFalling(e);
    return enemies.filter(e=>e.fallZone).map(e=>({id:e.id,outcome:e.fallOutcome,dead:e.dead,prone:e.prone,speed:e.speed,damageMul:e.damageMul,aura:Boolean(e.aura),
      rotationZ:Number(e.group.rotation.z.toFixed(3)),rotationX:Number(e.group.rotation.x.toFixed(3)),y:Number(e.group.position.y.toFixed(3))}));
  };
  // v1.4: force a fall from a specific height, so the physics-driven outcome
  // can be asserted instead of the old independent dice roll.
  window.__debugForceFallHeight=(height=12,roll=.5)=>{
    const zone={id:`test-${height}`,x:0,z:player.group.position.z-12,height,side:1,kind:'roof'};
    const drop={zone,outcome:'enraged',fallTime:fallTime(height),at:gameTime,index:900+fallStats.spawned,roll};
    const e=spawnFalling(drop);
    return e?e.id:null;
  };
  // v1.4: the full population with the fields the physics/AI tests assert on.
  window.__debugPopulation=()=>enemies.filter(e=>!e.dead).map(e=>({
    id:e.id,kind:e.kind,role:e.role,mode:e.mode,alert:Number((e.alert||0).toFixed(3)),
    prone:Boolean(e.prone),falling:Boolean(e.falling),waiting:Boolean(e.waiting),
    fleeing:Boolean(e.fleeing),x:Number(e.group.position.x.toFixed(3)),
    z:Number(e.group.position.z.toFixed(3)),y:Number(e.group.position.y.toFixed(3)),
    rotationZ:Number(e.group.rotation.z.toFixed(3)),rotationX:Number(e.group.rotation.x.toFixed(3)),
    hp:e.hp,maxHp:e.maxHp,
  }));
  // v1.4: collider list, so the harness can prove no body is inside one.
  window.__debugColliders=()=>obstacles.map(o=>({...o}));
  // v1.4: perception probes, so the cone/occlusion/hearing rules are testable
  // without waiting for a zombie to wander into the right place.
  window.__debugVision=(from,facing,to)=>visionConfidence({from,facing,to,occluded:(a,b)=>lineBlocked(a,b)});
  window.__debugHearing=(from,to,strength)=>hearingConfidence({from,to,strength});
  // v1.4: force a zombie into a state, for the "no walking while prone" test.
  window.__debugSetState=(id,patch={})=>{
    const e=enemies.find(x=>x.id===id);
    if(!e)return null;
    Object.assign(e,patch);
    return {id:e.id,prone:e.prone,dead:e.dead,getup:e.getup};
  };
  // v1.4: graphics + frame stats, including the measured FPS.
  window.__debugPerf=()=>({quality:{id:qualityId,...quality},fps:{cap:fpsCap,...frameMeter.stats()},
    renderer:{...lastRenderInfo},zombies:{archetypes:zombieInstancer.archetypeCount,
      batches:zombieInstancer.drawCalls,instances:zombieInstancer.instanceCount},
    weather:{rain:rainField.count,smoke:smokePlumes.count,wet:wetResult.wet}});
  // v1.4: set the frame cap at runtime, so the harness can prove it throttles.
  window.__debugSetFps=(value)=>{fpsCap=Number(value);frameLimiter.setFps(Number(value));return fpsCap;};
  // v1.4: probe the limiter directly, without waiting on a real display.
  window.__debugShouldRender=(dtMs)=>frameLimiter.shouldRender(dtMs);
  // v1.4: run the instancer once and report what it drew, without a render.
  window.__debugInstancePass=()=>{
    scene.updateMatrixWorld();
    const near=enemies.filter(e=>!e.dead&&!e.falling&&e.group.visible&&e.nearLod);
    return {bodies:near.length,batches:zombieInstancer.update(near),instances:zombieInstancer.instanceCount};
  };
  // v1.4: gather every living zombie into a ring around the player. This is the
  // worst case for the draw-call budget, and the only honest way to measure it.
  window.__debugGather=(radius=6)=>{
    const p=player.group.position;
    const live=enemies.filter(e=>!e.dead&&!e.falling);
    live.forEach((e,i)=>{
      const a=(i/live.length)*Math.PI*2;
      const r=radius*(0.55+0.45*((i%5)/4));
      e.group.position.set(p.x+Math.cos(a)*r,0,p.z+Math.sin(a)*r);
      e.group.rotation.y=a+Math.PI;
      e.alert=1;e.mode='chase';e.lastKnown.copy(p);e.memoryAge=0;
    });
    return live.length;
  };
  // v1.4: render exactly one frame synchronously and report its real cost.
  // Reading `lastRenderInfo` after a wall-clock wait is unreliable on software
  // GL, where a frame takes ~2 s and the value is from an older frame.
  window.__debugRenderOnce=()=>{
    scene.updateMatrixWorld();
    const near=[],far=[];
    for(const e of enemies){
      if(e.dead||e.falling||!e.group.visible)continue;
      if(e.nearLod)near.push(e);else far.push(e);
    }
    zombieInstancer.update(near);
    zombieInstancer.updateFar(far);
    renderer.render(scene,camera);
    const info={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      points:renderer.info.render.points,lines:renderer.info.render.lines,
      bodies:near.length,farBodies:far.length,batches:zombieInstancer.drawCalls,
      nearBatches:zombieInstancer.nearDrawCalls,farBatches:zombieInstancer.farDrawCalls,
      instances:zombieInstancer.instanceCount};
    lastRenderInfo=info;
    return info;
  };
  // v1.4: where the draw calls actually go, grouped by the nearest named
  // ancestor. Guessing at this from the source is how you optimise the wrong
  // thing; this counts what the renderer will really submit.
  window.__debugSceneBreakdown=()=>{
    scene.updateMatrixWorld();
    const counts={};
    let total=0;
    // Ancestor visibility matters: the 12 weapon models live under one group and
    // only one is visible, but a naive traverse counts all 59 meshes.
    const visibleChain=o=>{let p=o;while(p){if(!p.visible)return false;p=p.parent;}return true;};
    scene.traverse(o=>{
      if(!(o.isMesh||o.isLine||o.isPoints||o.isSprite))return;
      if(!visibleChain(o))return;
      let p=o, label='(root)';
      while(p){ if(p.name){label=p.name;break;} p=p.parent; }
      counts[label]=(counts[label]||0)+1;
      total++;
    });
    return {total,counts:Object.entries(counts).sort((a,b)=>b[1]-a[1]).slice(0,18)};
  };
  // v1.4: the hero's own mesh list. 59 draws for one character is the largest
  // single block in the scene, so it is worth knowing exactly what they are.
  window.__debugHeroParts=()=>{
    const out=[];
    player.group.traverse(o=>{
      if(!(o.isMesh||o.isSprite))return;
      out.push({name:o.name||'(unnamed)',parent:o.parent?.name||'(none)',
        mat:o.material?.type,transparent:Boolean(o.material?.transparent),
        visible:o.visible});
    });
    return {count:out.length,parts:out};
  };
}
window.addEventListener('storage',e=>{if(e.key===ECONOMY_KEY&&profilePersistent){refreshProfile();updateProfileUI();if(phase!=='playing'&&phase!=='paused')applyLoadout(profile.weapon,profile.skin);}});
applyLoadout(profile.weapon,profile.skin);updateProfileUI();
window.__gameState=state;
$('loading').textContent='Nuevos personajes · 4 atuendos · Conserva tus compras';$('start').disabled=false;
let elapsed=0;
// Scene draw-call counts, captured before the grade pass resets renderer.info.
let lastRenderInfo={calls:0,triangles:0,points:0,lines:0};
// v1.3: the loop can be stopped. On software GL a running loop saturates the
// rasteriser so completely that even navigating away times out; the harness
// stops it before a reload.
let loopRunning=true;
function frame(){
  if(!loopRunning)return;
  requestAnimationFrame(frame);
  const raw=clock.getDelta();
  const dt=Math.min(raw,.045);elapsed+=dt;tick(dt,elapsed);
  // v1.4: the simulation always ticks at the real rate; only the *draw* is
  // capped. A 30 fps cap therefore does not make the game run in slow motion.
  frameMeter.push(raw*1000);
  const draw=frameLimiter.shouldRender(raw*1000);
  // The full-screen refuge needs no continuous 3D draws beneath its UI.
  if(draw&&phase!=='shop'&&!joystickEditor.isOpen()){
    // v1.4: mirror the posed rigs into the instanced batches. This has to run
    // after tick() (which writes the pivots) and before render().
    scene.updateMatrixWorld();
    const nearBodies=[],farBodies=[];
    for(const e of enemies){
      if(e.dead||e.falling||!e.group.visible)continue;
      if(e.nearLod)nearBodies.push(e);else farBodies.push(e);
    }
    zombieInstancer.update(nearBodies);
    zombieInstancer.updateFar(farBodies);
    renderer.render(scene,camera);
    // v1.3: the grade is a second render pass, and renderer.info is reset by
    // every render() call — so the scene's own counts are captured here, before
    // the quad overwrites them with "1 call, 2 triangles".
    lastRenderInfo={calls:renderer.info.render.calls,triangles:renderer.info.render.triangles,
      points:renderer.info.render.points,lines:renderer.info.render.lines,
      zombieBatches:zombieInstancer.drawCalls,zombieInstances:zombieInstancer.instanceCount};
    // v1.3: vignette + split-tone grade as one extra quad, not a CSS filter
    // (a CSS filter on the canvas forces a full framebuffer read every frame).
    if(quality.grade)grade.render();
  }}
frame();


function onButtonPress(btn, action){
  if(!btn) return;
  const trigger=(e)=>{
    e.preventDefault();
    e.stopPropagation();
    action(e);
  };
  btn.addEventListener('pointerdown', trigger);
  btn.addEventListener('click', (e)=>{ e.preventDefault(); });
}
onButtonPress(document.getElementById('btn-180'), turn180);
onButtonPress(document.getElementById('btn-turn180'), turn180);
onButtonPress(document.getElementById('btn-crouch'), toggleCrouch);
onButtonPress(document.getElementById('btn-sprint'), toggleSprint);
onButtonPress(document.getElementById('btn-flashlight'), toggleFlashlight);
onButtonPress(document.getElementById('btn-cam'), toggleFpsCamera);
onButtonPress(document.getElementById('btn-cam-view'), toggleFpsCamera);
onButtonPress(document.getElementById('btn-env'), cycleWeather);
onButtonPress(document.getElementById('intro-continue'), ()=>start(true));
onButtonPress(document.getElementById('end-menu'), ()=>{
  document.getElementById('end')?.classList.add('hidden');
  document.getElementById('intro')?.classList.remove('hidden');
  phase='intro';
  updateProfileUI();
});
onButtonPress(document.getElementById('classic-calc'), ()=>{
  if(phase==='playing'||phase==='paused'){
    openShop(phase);
  }
});
window.addEventListener('keydown', e=>{
  if(e.code==='KeyX'&&!e.repeat) turn180();
  if(e.code==='KeyC'&&!e.repeat) toggleCrouch();
});
