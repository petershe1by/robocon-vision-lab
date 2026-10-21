import * as THREE from 'three';
import JSZip from 'jszip';

const $ = id => document.getElementById(id);
const W=640,H=480, rad=d=>d*Math.PI/180, deg=r=>r*180/Math.PI;
const LABELS=__LABEL_IMAGES__;
const faceNames=['+X','-X','+Y','-Y','+Z','-Z'];
const normals=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
const colorNames={red:'红色',blue:'蓝色',mixed:'半红半蓝',unknown:'无法判断'};
const types={red:{name:'红色方块',size:.35,color:'#df2222'},blue:{name:'蓝色方块',size:.35,color:'#3200ff'},cap:{name:'塔顶',size:.2},food:{name:'食品箱',size:.2},tools:{name:'工具箱',size:.2},instruments:{name:'仪器箱',size:.2},medicine:{name:'药品箱',size:.2}};
let scene,camera,renderer,ambient,key,objects=[],selected=null,selectedFace=4,mode='main',interaction='select';
let points=[],pointFrame=null,pending=null,log=[],toastTimer=null,drag=null,ready=false;
let last=0,frames=0,fpsAt=0,frameSerial=0,recorder=null,recording=false;
const textures={};
const raycaster=new THREE.Raycaster();
const overlay=$('overlay').getContext('2d');

function notify(message){$('toast').textContent=message;$('toast').style.opacity='1';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.opacity='0',2600);}
function round(v,n=6){return Number(v.toFixed(n));}
function arr(v){return v.toArray().map(x=>round(x));}
function invalidate(reason='物块或相机已改变，请重新记录预测。'){
  if(pending){pending=null;$('verify').disabled=true;$('prediction-status').textContent=reason;}
}
function clearPoints(){points=[];pointFrame=null;updatePoints();}
function changed(){invalidate();clearPoints();}
function setModeButtons(){for(const m of ['main','quad']){$('mode-'+m).classList.toggle('active',mode===m);$('mode-'+m).setAttribute('aria-pressed',String(mode===m));}}
function disposeObjects(){for(const o of objects){scene.remove(o.mesh);o.mesh.geometry.dispose();o.mesh.material.forEach(m=>m.dispose());}objects=[];selected=null;}

function createTexture(draw){const c=document.createElement('canvas');c.width=c.height=512;draw(c.getContext('2d'));const t=new THREE.CanvasTexture(c);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=renderer.capabilities.getMaxAnisotropy();return t;}
async function loadTextures(){
  textures.mixed=createTexture(c=>{c.fillStyle='#df2222';c.fillRect(0,0,512,256);c.fillStyle='#3200ff';c.fillRect(0,256,512,256);});
  for(const [name,src] of Object.entries(LABELS)){
    const im=new Image();im.src=src;await im.decode();
    textures[name]=createTexture(c=>{c.fillStyle='#fff';c.fillRect(0,0,512,512);c.drawImage(im,9,9,494,494);});
  }
}
function material(color,map=null){return new THREE.MeshStandardMaterial({color,map,roughness:.88,metalness:0});}
function createObject(type,index,x,z,angles=[0,0,0]){
  const spec=types[type];
  let mats;
  if(type==='cap')mats=[material('#fff',textures.mixed),material('#fff',textures.mixed),material('#df2222'),material('#3200ff'),material('#fff',textures.mixed),material('#fff',textures.mixed)];
  else if(textures[type])mats=Array.from({length:6},()=>material('#fff',textures[type]));
  else mats=Array.from({length:6},()=>material(spec.color));
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(spec.size,spec.size,spec.size),mats);
  mesh.castShadow=true;mesh.receiveShadow=true;
  const o={id:type+'_'+index,type,size:spec.size,mesh};mesh.userData.object=o;
  mesh.rotation.set(...angles.map(rad),'XYZ');mesh.position.set(x,0,z);ground(o);
  scene.add(mesh);objects.push(o);return o;
}
function localCorners(o){const s=o.size/2;return [-1,1].flatMap(x=>[-1,1].flatMap(y=>[-1,1].map(z=>new THREE.Vector3(x*s,y*s,z*s))));}
function ground(o){let min=Infinity;for(const p of localCorners(o)){p.applyQuaternion(o.mesh.quaternion);min=Math.min(min,p.y);}o.mesh.position.y=-min+.001;}
function preset(resetCamera=true){
  changed();$('spin').checked=false;disposeObjects();
  if(mode==='main'){
    createObject('red',1,-.48,.04,[0,14,0]);createObject('blue',1,.48,.02,[0,-17,0]);selected=createObject('cap',1,0,-.16,[0,12,0]);
  }else{
    ['food','tools','instruments','medicine'].forEach((type,i)=>createObject(type,1,(i-1.5)*.34,Math.abs(i-1.5)>.6?0:-.12,[0,[18,-12,12,-18][i],0]));selected=objects[0];
  }
  selectedFace=4;setModeButtons();fillObjects();
  $('scene-title').textContent=mode==='main'?'主赛物块 · 单目观察':'四足物资箱 · 单目观察';
  $('scene-subtitle').textContent=mode==='main'?'350 mm 红蓝方块 / 200 mm 半红半蓝塔顶':'200 mm 物资箱 / 使用赛规原始标识';
  $('object-count').textContent=objects.length+' 个物块';
  $('prediction-hint').textContent=mode==='main'?'先选可见面，记录对其相对面的预测，再翻转同一物块验证。':'四足方向主要练习标识分类与PnP；背面颜色预测为主赛进阶任务。';
  for(const id of ['prediction','lock-prediction'])$(id).disabled=mode!=='main';
  $('prediction-status').textContent=mode==='main'?'尚未记录预测。验证前不显示相对面的颜色答案。':'请切换到主赛方向练习背面颜色预测。';
  if(resetCamera){for(const [k,v] of Object.entries({azimuth:0,elevation:25,distance:2000,hfov:60,light:100}))$(k).value=v;}
  syncCamera();syncObject();chooseFrontFace();render();
}
function fillObjects(){const el=$('object');el.replaceChildren();for(const o of objects){const op=document.createElement('option');op.value=o.id;op.textContent=types[o.type].name+' · '+o.id;el.append(op);}if(selected)el.value=selected.id;}
function duplicateObject(){
  if(!selected||objects.length>=12){notify('最多支持12个物块。');return;}changed();$('spin').checked=false;
  let i=1;while(objects.some(o=>o.id===selected.type+'_'+i))i++;
  const angles=[selected.mesh.rotation.x,selected.mesh.rotation.y,selected.mesh.rotation.z].map(deg);
  selected=createObject(selected.type,i,Math.min(.8,selected.mesh.position.x+.25),selected.mesh.position.z+.06,angles);
  fillObjects();syncObject();chooseFrontFace();$('object-count').textContent=objects.length+' 个物块';render();
}
function removeObject(){
  if(objects.length<=1){notify('至少保留一个物块，可移动到画面外练习目标丢失。');return;}
  changed();$('spin').checked=false;const o=selected;scene.remove(o.mesh);o.mesh.geometry.dispose();o.mesh.material.forEach(m=>m.dispose());objects=objects.filter(x=>x!==o);selected=objects[0];
  fillObjects();syncObject();chooseFrontFace();$('object-count').textContent=objects.length+' 个物块';render();
}
function syncObject(){
  if(!selected)return;
  $('object').value=selected.id;$('object-meta').textContent=`边长 ${selected.size*1000} mm · 编辑器世界坐标`;
  const angles=new THREE.Euler().setFromQuaternion(selected.mesh.quaternion,'XYZ');
  const values={'obj-x':Math.round(selected.mesh.position.x*1000),'obj-z':Math.round(selected.mesh.position.z*1000),'rot-x':Math.round(deg(angles.x)),'rot-y':Math.round(deg(angles.y)),'rot-z':Math.round(deg(angles.z))};
  for(const [id,v] of Object.entries(values)){$(id).value=v;$(id+'-out').textContent=v+(id.startsWith('obj')?' mm':'°');}
}
function intrinsics(){const f=W/(2*Math.tan(rad(Number($('hfov').value))/2));return {width:W,height:H,model:'pinhole',camera_matrix:[[f,0,W/2],[0,f,H/2],[0,0,1]],distortion_coefficients:[0,0,0,0,0],distortion_model:'plumb_bob',optical_axes:{x:'right',y:'down',z:'forward'},units:'m',fov_horizontal_deg:Number($('hfov').value),note:'camera_matrix corresponds to image.png at 640x480; zero distortion in simulation'};}
function syncCamera(){
  const az=rad(Number($('azimuth').value)),el=rad(Number($('elevation').value)),d=Number($('distance').value)/1000,hfov=rad(Number($('hfov').value));
  const target=new THREE.Vector3(0,.17,0);
  camera.position.copy(target).add(new THREE.Vector3(d*Math.cos(el)*Math.sin(az),d*Math.sin(el),d*Math.cos(el)*Math.cos(az)));
  camera.lookAt(target);camera.fov=deg(2*Math.atan(Math.tan(hfov/2)*H/W));camera.updateProjectionMatrix();camera.updateMatrixWorld(true);
  const lighting=Number($('light').value)/100;ambient.intensity=1.7*lighting;key.intensity=2.2*lighting;
  for(const id of ['azimuth','elevation','distance','hfov','light'])$(id+'-out').textContent=$(id).value+(id==='distance'?' mm':id==='light'?'%':'°');
  $('camera-info').textContent=JSON.stringify(intrinsics(),null,2);
}
function faceCenter(o,index){return new THREE.Vector3(...normals[index]).multiplyScalar(o.size/2).applyMatrix4(o.mesh.matrixWorld);}
function faceNormal(o,index){return new THREE.Vector3(...normals[index]).applyQuaternion(o.mesh.quaternion).normalize();}
function faceLocalCorners(o,index){const a=o.mesh.geometry.attributes.position;return [0,1,3,2].map(v=>new THREE.Vector3().fromBufferAttribute(a,index*4+v));}
function project(p){const v=p.clone().project(camera);return [(v.x+1)*W/2,(1-v.y)*H/2];}
function toOptical(p){const c=p.clone().applyMatrix4(camera.matrixWorldInverse);return new THREE.Vector3(c.x,-c.y,-c.z);}
function chooseFrontFace(){if(!selected)return;scene.updateMatrixWorld(true);let score=-Infinity;for(let i=0;i<6;i++){const d=camera.position.clone().sub(faceCenter(selected,i)).normalize().dot(faceNormal(selected,i));if(d>score){score=d;selectedFace=i;}}updateFaceStatus();}
function updateFaceStatus(){if(!selected)return;$('face-status').textContent=`选中 ${types[selected.type].name} · 局部 ${faceNames[selectedFace]} 面`+ (interaction==='points'?' · 正在点选四角':' · 点击可切换表面');}
function selectObject(o,face=null){invalidate();clearPoints();selected=o;syncObject();if(face===null)chooseFrontFace();else{selectedFace=face;updateFaceStatus();}render();}
function render(){if(!ready)return;scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);renderer.render(scene,camera);drawOverlay();frameSerial++;}
function drawOverlay(){
  overlay.clearRect(0,0,W,H);
  if(interaction==='select'&&selected){const ps=faceLocalCorners(selected,selectedFace).map(v=>project(v.applyMatrix4(selected.mesh.matrixWorld)));overlay.strokeStyle='#4e89ff';overlay.lineWidth=2;overlay.setLineDash([5,4]);overlay.beginPath();ps.forEach(([x,y],i)=>i?overlay.lineTo(x,y):overlay.moveTo(x,y));overlay.closePath();overlay.stroke();overlay.setLineDash([]);}
  for(let i=0;i<points.length;i++){const [x,y]=points[i];overlay.fillStyle='#ffc95d';overlay.strokeStyle='#263a55';overlay.lineWidth=2;overlay.beginPath();overlay.arc(x,y,5,0,Math.PI*2);overlay.fill();overlay.stroke();overlay.font='bold 13px sans-serif';overlay.fillStyle='#132b49';overlay.fillText(String(i+1),x+9,y-8);}
}
function setInteraction(value){interaction=value;$('interaction-label').textContent=value==='points'?'手动角点点选':'选择物块表面';$('rgb').style.cursor=value==='points'?'crosshair':'grab';updateFaceStatus();drawOverlay();}
function updatePoints(){$('points-status').textContent=points.length?`已点选 ${points.length}/4 个角点\n${points.map((p,i)=>`${i+1}: (${p[0].toFixed(1)}, ${p[1].toFixed(1)}) px`).join('  ')}`:'尚未点选角点。基础档允许手动点选；进阶档请在自己的程序中自动提取。';drawOverlay();}
function faceColor(o,index){if(o.type==='cap')return index===2?'red':index===3?'blue':'mixed';return o.type==='red'?'red':o.type==='blue'?'blue':'unknown';}
function lockPrediction(){
  if(mode!=='main'||!selected)return;
  $('spin').checked=false;render();
  const n=faceNormal(selected,selectedFace),v=camera.position.clone().sub(faceCenter(selected,selectedFace)).normalize();
  if(n.dot(v)<=.05){notify('请先点击一个朝向相机的可见面。');return;}
  pending={objectId:selected.id,frontFace:selectedFace,backFace:selectedFace^1,prediction:$('prediction').value,recordedAt:new Date().toISOString()};
  $('verify').disabled=false;$('prediction-status').textContent=`已记录：${selected.id} / ${faceNames[selectedFace]} 面的相对面\n你的预测：${colorNames[pending.prediction]}。点击“翻面并验证”揭示同一物理面。`;
}
function verifyPrediction(){
  if(!pending)return;const saved={...pending};const o=objects.find(x=>x.id===saved.objectId);if(!o){invalidate();return;}
  const n=faceNormal(o,saved.frontFace);let axis=n.clone().cross(camera.up);if(axis.lengthSq()<.001)axis=n.clone().cross(new THREE.Vector3(1,0,0));axis.normalize();
  o.mesh.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(axis,Math.PI));ground(o);selected=o;selectedFace=saved.backFace;syncObject();clearPoints();
  const actual=faceColor(o,saved.backFace),correct=saved.prediction==='unknown'?null:saved.prediction===actual;
  log.push({...saved,actual,correct,verifiedAt:new Date().toISOString()});pending=null;$('verify').disabled=true;
  const judged=log.filter(x=>x.correct!==null),hits=judged.filter(x=>x.correct).length;
  $('prediction-status').textContent=`揭示 ${faceNames[saved.backFace]} 面：${colorNames[actual]}\n${correct===null?'本次选择无法判断，记为拒绝预测。':correct?'本次预测正确。':'本次预测不一致。'} 累计 ${hits}/${judged.length} 次有效预测正确；覆盖 ${judged.length}/${log.length}。`;
  updateFaceStatus();render();
}
function cameraState(){const result={};for(const k of ['azimuth','elevation','distance','hfov','light'])result[k]=Number($(k).value);return result;}
function sceneConfig(){return {format:'initial-vision-scene-v1',mode,level:$('level').value,camera:cameraState(),objects:objects.map(o=>({id:o.id,type:o.type,position_m:[round(o.mesh.position.x),round(o.mesh.position.z)],rotation_deg:arr(new THREE.Vector3(...o.mesh.rotation.toArray().slice(0,3))).map(deg).map(x=>round(x,3))}))};}
function matrixRows(matrix){const e=matrix.elements;return Array.from({length:4},(_,r)=>Array.from({length:4},(_,c)=>round(e[c*4+r])));}
function groundTruth(){
  scene.updateMatrixWorld(true);camera.updateMatrixWorld(true);
  const f=new THREE.Matrix4().makeScale(1,-1,-1);
  return {format:'initial-vision-ground-truth-v1',purpose:'reference_only_do_not_feed_to_detector',units:'m',world_axes:'X right, Y up, Z toward default camera',frame_id:'camera_optical',objects:objects.map(o=>{
    const m=f.clone().multiply(camera.matrixWorldInverse).multiply(o.mesh.matrixWorld);
    const center=toOptical(o.mesh.position);
    return {id:o.id,class:o.type,edge_length_m:o.size,center_optical_m:arr(center),T_object_to_camera_optical:matrixRows(m),faces:faceNames.map((name,i)=>{
      const c=faceCenter(o,i),n=faceNormal(o,i),corners=faceLocalCorners(o,i).map(v=>v.applyMatrix4(o.mesh.matrixWorld));
      return {local_face:name,color:faceColor(o,i),center_optical_m:arr(toOptical(c)),corners_optical_m:corners.map(v=>arr(toOptical(v))),projected_corners_px:corners.map(v=>project(v).map(x=>round(x,3))),front_facing:n.dot(camera.position.clone().sub(c))>0};
    })};}),note:'Projected corners are geometric, not clipped and not occlusion-tested. front_facing does not guarantee visibility.'};
}
function download(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),10000);}
function jsonDownload(data,name){download(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),name);}
function pngBlob(){return new Promise((resolve,reject)=>renderer.domElement.toBlob(b=>b?resolve(b):reject(new Error('无法导出相机图像')),'image/png'));}
function syncRecordingOptions(){$('record-duration').disabled=$('record-mode').value==='manual';}
function recordingClock(seconds){const s=Math.floor(seconds);return [Math.floor(s/3600),Math.floor(s/60)%60,s%60].map(x=>String(x).padStart(2,'0')).join(':');}
async function recordVideo(){
  if(recording){if(recorder.state==='recording')recorder.stop();return;}
  const timed=$('record-mode').value==='timed',duration=Number($('record-duration').value);
  if(timed&&(!Number.isInteger(duration)||duration<1||duration>3600)){notify('请输入1至3600之间的整数秒数。');$('record-duration').focus();return;}
  if(!window.MediaRecorder||!renderer.domElement.captureStream){notify('当前浏览器不支持Canvas视频录制，请导出图像样本。');return;}
  const mime=['video/webm;codecs=vp8','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));
  if(!mime){notify('当前浏览器没有可用的WebM编码器。');return;}
  const input=intrinsics(),started=new Date().toISOString(),chunks=[];
  const controls=['hfov','level','randomize','reset','mode-main','mode-quad','import-scene','export-sample','export-points','duplicate','remove-object','record-mode','record-duration'];
  let stream,current,stopTimer,ticker,byteCount=0,startedAt=0,recordError=null;
  try{stream=renderer.domElement.captureStream(15);current=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2500000});}catch(e){stream?.getTracks().forEach(t=>t.stop());notify('视频录制无法启动：'+e.message);return;}
  const beforeLeave=e=>{e.preventDefault();e.returnValue='';};
  const progress=()=>{$('recording-status').textContent=`正在录制 ${recordingClock((performance.now()-startedAt)/1000)}${timed?' / '+recordingClock(duration):' · 手动停止'} · 已编码 ${(byteCount/1048576).toFixed(1)} MB\n可调整物块和观察视角；点击“停止并导出”可提前结束。`;};
  const restore=()=>{controls.forEach(id=>$(id).disabled=false);syncRecordingOptions();$('record-video').disabled=false;$('record-video').textContent='开始录制';window.removeEventListener('beforeunload',beforeLeave);};
  current.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);byteCount+=e.data.size;}};
  current.onerror=e=>{recordError=e.error?.message||'浏览器录制发生错误';if(current.state==='recording')current.stop();};
  current.onstop=async()=>{
    clearTimeout(stopTimer);clearInterval(ticker);recording=false;recorder=null;stream.getTracks().forEach(t=>t.stop());
    const elapsed=(performance.now()-startedAt)/1000;
    $('record-video').disabled=true;$('record-video').textContent='正在生成 ZIP…';$('recording-status').textContent=`录制结束 ${recordingClock(elapsed)} · 正在打包视频和内参…`;
    try{
      if(!byteCount)throw new Error(recordError||'没有录制到视频数据，请重新录制');
      const zip=new JSZip();zip.file('video.webm',new Blob(chunks,{type:mime}));
      zip.file('camera_info.json',JSON.stringify({...input,recording_started_at:started,recording_stopped_at:new Date().toISOString(),recording_elapsed_seconds:round(elapsed,3),recording_mode:timed?'timed':'manual',requested_duration_seconds:timed?duration:null,requested_fps:15,recording_error:recordError},null,2));
      zip.file('README.txt','video.webm为640x480单目视频，目标采样率15fps，实际帧率受浏览器与硬件影响。\n录制期间水平视场角固定，camera_info.json内参适用于全段视频。\nrecording_elapsed_seconds为浏览器录制墙钟时长，视频实际时长请以解码时间戳为准。\n视频不含UI选框和标记，也不附逐帧模型真值。\n可使用OpenCV VideoCapture按帧读取。\n'+(recordError?'录制异常：'+recordError+'，本文件为已收到的部分视频数据。':''));
      download(await zip.generateAsync({type:'blob'}),'vision_video_'+Date.now()+'.zip');
      $('recording-status').textContent=`${recordError?'录制异常，已导出收到的部分视频':'已导出视频和固定相机内参'} · ${recordingClock(elapsed)} · ${(byteCount/1048576).toFixed(1)} MB${recordError?'\n'+recordError:''}`;notify(recordError?'录制出现异常，已保存收到的部分视频。':'视频和固定相机内参已导出。');
    }catch(e){$('recording-status').textContent='视频导出失败：'+e.message;notify('视频导出失败：'+e.message);}finally{chunks.length=0;restore();}
  };
  try{current.start(1000);}catch(e){stream.getTracks().forEach(t=>t.stop());notify('视频录制无法启动：'+e.message);return;}
  recorder=current;recording=true;startedAt=performance.now();controls.forEach(id=>$(id).disabled=true);$('record-video').textContent='停止并导出';window.addEventListener('beforeunload',beforeLeave);progress();ticker=setInterval(progress,250);
  if(timed)stopTimer=setTimeout(()=>{if(current.state==='recording')current.stop();},duration*1000);
  notify(timed?`开始录制，${duration}秒后自动导出，也可提前停止。`:'开始持续录制，点击“停止并导出”结束。');
}
function frameSnapshot(){render();return {time:new Date().toISOString(),serial:frameSerial,k:intrinsics(),scene:sceneConfig(),truth:$('include-truth').checked?groundTruth():null};}
async function exportSample(withPoints=false){
  try{
    if(withPoints&&points.length!==4){notify('请先点击“点选四角”，在同一个面上点满四点。');return;}
    $('spin').checked=false;
    const snapshot=withPoints?pointFrame:frameSnapshot();
    if(!snapshot){notify('角点对应的图像已失效，请重新点选。');return;}
    const zip=new JSZip();
    const blob=withPoints?snapshot.png:await pngBlob();zip.file('image.png',blob);
    zip.file('camera_info.json',JSON.stringify({...snapshot.k,captured_at:snapshot.time,frame_serial:snapshot.serial},null,2));
    if(withPoints){const s=snapshot.edge/2;zip.file('points.json',JSON.stringify({format:'manual-planar-pnp-v1',image_points_px:points,object_points_m:[[-s,s,0],[s,s,0],[s,-s,0],[-s,-s,0]],object_origin:'selected_square_face_center',point_order:'image top-left, top-right, bottom-right, bottom-left along the same face',edge_length_m:snapshot.edge,captured_at:snapshot.time},null,2));}
    if(snapshot.truth)zip.file('ground_truth.json',JSON.stringify(snapshot.truth,null,2));
    zip.file('README.txt','算法输入：image.png + camera_info.json。\npoints.json（如有）为人工点选的单面角点。\n长度单位m；光学坐标X右、Y下、Z前。\nimage.png不含UI选中框和点选标记。\n这是理想针孔渲染样本，不代表实拍精度。\n若附ground_truth.json，它仅用于独立误差核对，不应作为识别器输入。');
    download(await zip.generateAsync({type:'blob'}),`vision_${mode}_${withPoints?'pnp':'sample'}_${Date.now()}.zip`);notify('样本已生成，包含原始图像和对应内参。');
  }catch(e){notify('导出失败：'+e.message);}
}
function validateConfig(x){
  if(!x||x.format!=='initial-vision-scene-v1'||!['main','quad'].includes(x.mode))throw new Error('不是有效的仿真场景文件');
  if(!Array.isArray(x.objects)||x.objects.length<1||x.objects.length>12)throw new Error('物块数量应为1至12个');
  const allowed=x.mode==='main'?['red','blue','cap']:['food','tools','instruments','medicine'];
  const ids=new Set();
  for(const o of x.objects){if(!allowed.includes(o.type)||!Array.isArray(o.position_m)||o.position_m.length!==2||!o.position_m.every(v=>Number.isFinite(v)&&Math.abs(v)<=1.5)||!Array.isArray(o.rotation_deg)||o.rotation_deg.length!==3||!o.rotation_deg.every(v=>Number.isFinite(v)&&Math.abs(v)<=360))throw new Error('物块配置或坐标无效');if(o.id!==undefined){if(typeof o.id!=='string'||!new RegExp('^'+o.type+'_\\d+$').test(o.id)||ids.has(o.id))throw new Error('物块ID格式无效或重复');ids.add(o.id);}}
  const limits={azimuth:[-180,180],elevation:[10,75],distance:[1000,4000],hfov:[35,85],light:[45,150]};
  if(!x.camera)throw new Error('缺少相机配置');
  for(const [k,[lo,hi]]of Object.entries(limits)){if(!Number.isFinite(x.camera[k])||x.camera[k]<lo||x.camera[k]>hi)throw new Error('相机参数超出范围：'+k);}
  return x;
}
function importConfig(x){
  validateConfig(x);changed();$('spin').checked=false;mode=x.mode;$('level').value=x.level==='advanced'?'advanced':'basic';preset(false);disposeObjects();
  x.objects.forEach((o,i)=>{const obj=createObject(o.type,i+1,...o.position_m,o.rotation_deg);if(o.id)obj.id=o.id;});selected=objects[0];fillObjects();syncObject();
  for(const [k,v]of Object.entries(x.camera))if(['azimuth','elevation','distance','hfov','light'].includes(k))$(k).value=v;
  $('object-count').textContent=objects.length+' 个物块';syncCamera();chooseFrontFace();render();notify('场景配置已载入。');
}
function randomize(){
  changed();$('spin').checked=false;const advanced=$('level').value==='advanced';
  const order=[...objects].sort(()=>Math.random()-.5);const spacing=advanced?.26:mode==='main'?.53:.38;
  order.forEach((o,i)=>{o.mesh.position.x=(i-(order.length-1)/2)*spacing+(Math.random()-.5)*.05;o.mesh.position.z=(Math.random()-.5)*(advanced?.38:.18);o.mesh.rotation.set(rad(advanced?(Math.random()-.5)*45:0),Math.random()*Math.PI*2,rad(advanced?(Math.random()-.5)*35:0));ground(o);});
  syncObject();chooseFrontFace();render();notify(advanced?'已生成倾斜、可能局部遮挡的物块布局。':'已重新摆放物块。');
}
function coordinate(e){const r=$('rgb').getBoundingClientRect();return [(e.clientX-r.left)*W/r.width,(e.clientY-r.top)*H/r.height];}
function clickCanvas(e){
  const p=coordinate(e);
  if(interaction==='points'){
    if(points.length===4)clearPoints();
    if(!points.length){$('spin').checked=false;const f=frameSnapshot();f.edge=selected.size;f.png=renderer.domElement.toDataURL('image/png').split(',')[1];f.png=Uint8Array.from(atob(f.png),c=>c.charCodeAt(0));pointFrame=f;}
    points.push(p.map(x=>round(x,3)));updatePoints();return;
  }
  raycaster.setFromCamera(new THREE.Vector2(p[0]/W*2-1,1-p[1]/H*2),camera);
  const hit=raycaster.intersectObjects(objects.map(o=>o.mesh))[0];
  if(hit)selectObject(hit.object.userData.object,hit.face.materialIndex);
}
function bind(){
  for(const m of ['main','quad'])$('mode-'+m).onclick=()=>{mode=m;preset();};
  $('object').onchange=()=>selectObject(objects.find(o=>o.id===$('object').value));
  $('duplicate').onclick=duplicateObject;$('remove-object').onclick=removeObject;
  for(const id of ['obj-x','obj-z','rot-x','rot-y','rot-z'])$(id).oninput=()=>{changed();$('spin').checked=false;selected.mesh.position.x=Number($('obj-x').value)/1000;selected.mesh.position.z=Number($('obj-z').value)/1000;selected.mesh.rotation.set(rad(Number($('rot-x').value)),rad(Number($('rot-y').value)),rad(Number($('rot-z').value)),'XYZ');ground(selected);syncObject();chooseFrontFace();render();};
  for(const id of ['azimuth','elevation','distance','hfov','light'])$(id).oninput=()=>{changed();syncCamera();chooseFrontFace();render();};
  $('spin').onchange=()=>{changed();};$('randomize').onclick=randomize;$('reset').onclick=()=>preset();$('level').onchange=randomize;
  $('select-mode').onclick=()=>setInteraction('select');$('point-mode').onclick=()=>{clearPoints();$('spin').checked=false;setInteraction('points');};$('clear-points').onclick=clearPoints;
  $('lock-prediction').onclick=lockPrediction;$('verify').onclick=verifyPrediction;$('export-log').onclick=()=>jsonDownload({format:'back-face-verification-v1',records:log},'back_face_results.json');
  $('export-sample').onclick=()=>exportSample(false);$('export-points').onclick=()=>exportSample(true);
  $('record-video').onclick=recordVideo;
  $('record-mode').onchange=syncRecordingOptions;syncRecordingOptions();
  $('show-k').onclick=()=>{$('camera-details').open=!$('camera-details').open;};
  $('export-scene').onclick=()=>jsonDownload(sceneConfig(),'vision_scene.json');$('import-scene').onclick=()=>$('import-file').click();
  $('import-file').onchange=async e=>{try{if(e.target.files[0])importConfig(JSON.parse(await e.target.files[0].text()));}catch(error){notify('载入失败：'+error.message);}e.target.value='';};
  const canvas=$('rgb');canvas.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,moved:false,az:Number($('azimuth').value),el:Number($('elevation').value)};canvas.setPointerCapture(e.pointerId);});
  canvas.addEventListener('pointermove',e=>{if(!drag||interaction==='points')return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.abs(dx)+Math.abs(dy)>5)drag.moved=true;if(drag.moved){changed();$('azimuth').value=Math.max(-180,Math.min(180,drag.az-dx*.3));$('elevation').value=Math.max(10,Math.min(75,drag.el+dy*.2));syncCamera();chooseFrontFace();render();}});
  canvas.addEventListener('pointerup',e=>{if(drag&&!drag.moved)clickCanvas(e);drag=null;});canvas.addEventListener('pointercancel',()=>drag=null);
  canvas.addEventListener('wheel',e=>{e.preventDefault();changed();$('distance').value=Math.max(1000,Math.min(4000,Number($('distance').value)+Math.sign(e.deltaY)*80));syncCamera();chooseFrontFace();render();},{passive:false});
}
function animate(t){
  requestAnimationFrame(animate);if(!ready)return;const dt=Math.min((t-last)/1000,.05);last=t;
  if($('spin').checked&&selected){selected.mesh.rotateY(dt*.35);ground(selected);syncObject();chooseFrontFace();render();}else if(recording){render();}
  frames++;if(t-fpsAt>1200){$('runtime-status').textContent=`仿真已就绪 · ${objects.length} 个物块 · 相机输出 ${W} × ${H} · 光学坐标 X右 / Y下 / Z前 · 画面按需更新`;$('version').textContent='v1.1 · Three.js '+THREE.REVISION;frames=0;fpsAt=t;}
}
async function init(){
  renderer=new THREE.WebGLRenderer({canvas:$('rgb'),antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(W,H,false);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.NoToneMapping;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;
  scene=new THREE.Scene();scene.background=new THREE.Color('#e4eaf2');camera=new THREE.PerspectiveCamera(45,W/H,.02,20);
  ambient=new THREE.HemisphereLight('#ffffff','#c3cbd7',1.7);scene.add(ambient);key=new THREE.DirectionalLight('#ffffff',2.2);key.position.set(-2.5,4,3);key.castShadow=true;key.shadow.mapSize.set(1024,1024);key.shadow.camera.left=-2;key.shadow.camera.right=2;key.shadow.camera.top=2;key.shadow.camera.bottom=-2;key.shadow.normalBias=.003;scene.add(key);
  const table=new THREE.Mesh(new THREE.PlaneGeometry(10,10),material('#d8dfe8'));table.rotation.x=-Math.PI/2;table.receiveShadow=true;scene.add(table);
  await loadTextures();ready=true;bind();preset();setInteraction('select');requestAnimationFrame(animate);
  $('runtime-status').textContent='仿真已就绪 · 可拖动画面、调整物块并导出样本。';
  // Development inspection only. Ground truth is deliberately not a secrecy boundary.
  window.visionSim={getCameraInfo:intrinsics,getScene:sceneConfig,getGroundTruth:groundTruth,getState:()=>({mode,selected:selected?.id,selectedFace,points,pending,records:log,ready}),importScene:importConfig};
}
init().catch(e=>{console.error(e);$('fatal').style.display='block';$('fatal').textContent='仿真初始化失败：'+e.message+'。请使用支持WebGL2的现代Chrome或Edge浏览器，并确认图形加速可用。';$('runtime-status').textContent='初始化未完成';});
