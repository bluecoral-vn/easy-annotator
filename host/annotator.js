/* bc-annotator v3 | embed: <script src="index.php"></script>
   Copyright (C) 2026 Blue Coral <https://bluecoral.vn>
   SPDX-License-Identifier: GPL-3.0-or-later
   API is inferred from the script URL (index.php or annotator.js → annotations.php).
   optional override: window.ANNOTATOR_API="https://host/annotations.php"
   AI reply: POST $API?url=&action=reply&id=A01  Authorization: Bearer <anno-data/.ai-token>
   no API = localStorage mode (http, https, file://) */
(function(root){
'use strict';

var Model = {};

Model.uid = function(){
  return 'a'+Date.now().toString(36)+Math.random().toString(36).slice(2,7);
};
Model.commentOf = function(a){
  return a&&a.edits&&a.edits.length?a.edits[a.edits.length-1].text:'';
};
Model.pubIdFromIndex = function(n){
  n=Math.max(0, parseInt(n,10)||0);
  var series=Math.floor(n/99);
  var num=(n%99)+1;
  var pad=num<10?('0'+num):String(num);
  return String.fromCharCode(65+series)+pad;
};
Model.nextPubId = function(list){
  var used={}, i, a, n=0, idx, max=-1, m, series, num;
  for(i=0;i<(list||[]).length;i++){
    a=list[i]; if(!a||!a.pubId) continue;
    used[a.pubId]=true;
    m=String(a.pubId).match(/^([A-Z])(\d{2})$/);
    if(!m) continue;
    num=parseInt(m[2],10);
    if(num<1||num>99) continue;
    series=m[1].charCodeAt(0)-65;
    idx=series*99+(num-1);
    if(idx>max) max=idx;
  }
  n=max+1;
  while(used[Model.pubIdFromIndex(n)]) n++;
  return Model.pubIdFromIndex(n);
};
Model.ensurePubIds = function(list){
  list=list||[];
  var i, sorted=list.slice().sort(function(a,b){
    return (a.createdAt||'').localeCompare(b.createdAt||'');
  });
  for(i=0;i<sorted.length;i++){
    if(sorted[i]&&!sorted[i].pubId) sorted[i].pubId=Model.nextPubId(list);
  }
  return list;
};
Model.normalizeAnno = function(a){
  if(!a) return a;
  if((!a.edits||!a.edits.length)&&a.editHistory&&a.editHistory.length) a.edits=a.editHistory.slice();
  if((!a.edits||!a.edits.length)&&a.comment){
    a.edits=[{text:a.comment,ts:a.updatedAt||a.createdAt||'',author:a.author||''}];
  }
  if((a.pos==null||typeof a.pos==='undefined')&&a.positionHint!=null) a.pos=a.positionHint;
  if(!a.anchorQ&&a.anchorQuality) a.anchorQ=a.anchorQuality;
  if(!a.kind) a.kind='text';
  if(!a.replies) a.replies=[];
  return a;
};
Model.ownsAnno = function(a, ownerKey){
  if(!a) return false;
  if(!a.ownerId) return true;
  return !!ownerKey && a.ownerId===ownerKey;
};
Model.stripSecrets = function(doc){
  doc=doc||{};
  function dropOwner(obj){
    var o={}, k;
    if(!obj) return obj;
    for(k in obj){
      if(!Object.prototype.hasOwnProperty.call(obj,k)) continue;
      if(k==='ownerId') continue;
      o[k]=obj[k];
    }
    return o;
  }
  return {
    v:doc.v, page:doc.page, deletedIds:doc.deletedIds||[],
    annotations:(doc.annotations||[]).map(function(a){
      var copy=dropOwner(a);
      copy.replies=(a.replies||[]).map(dropOwner);
      return copy;
    })
  };
};
Model.replyLink = function(apiBase, pageUrl, pubId){
  if(!apiBase||!pubId) return '';
  var sep=apiBase.indexOf('?')>-1?'&':'?';
  return apiBase+sep+'url='+encodeURIComponent(pageUrl||'')+'&action=reply&id='+encodeURIComponent(pubId);
};
Model.sortAnnos = function(list, mode){
  var arr=(list||[]).slice();
  if(mode==='createdDesc') arr.sort(function(a,b){return (b.createdAt||'').localeCompare(a.createdAt||'');});
  else if(mode==='pos') arr.sort(function(a,b){return (a.pos||0)-(b.pos||0);});
  else arr.sort(function(a,b){return (a.createdAt||'').localeCompare(b.createdAt||'');});
  return arr;
};
Model.mergeDeletedIds = function(a, b){
  var map={}, src=(a||[]).concat(b||[]), i, t;
  for(i=0;i<src.length;i++){
    t=src[i];if(!t||!t.id)continue;
    if(!map[t.id]||(t.ts||'')>(map[t.id].ts||'')) map[t.id]={id:t.id,ts:t.ts||''};
  }
  return Object.keys(map).map(function(k){return map[k];});
};
Model.isTombstoned = function(id, tombs, updatedAt){
  var i,t;
  for(i=0;i<(tombs||[]).length;i++){
    t=tombs[i];
    if(t&&t.id===id&&(t.ts||'')>=(updatedAt||'')) return true;
  }
  return false;
};
Model.mergeDocs = function(cur, incoming){
  cur=cur||{};incoming=incoming||{};
  var tombs=Model.mergeDeletedIds(cur.deletedIds, incoming.deletedIds);
  var map={}, src=(cur.annotations||[]).concat(incoming.annotations||[]), i,a;
  for(i=0;i<src.length;i++){
    a=src[i];if(!a||!a.id)continue;
    if(Model.isTombstoned(a.id,tombs,a.updatedAt)) continue;
    if(!map[a.id]||(a.updatedAt||'')>(map[a.id].updatedAt||'')) map[a.id]=a;
  }
  var annos=[];
  Object.keys(map).forEach(function(k){
    if(!Model.isTombstoned(map[k].id,tombs,map[k].updatedAt)) annos.push(map[k]);
  });
  return {annotations:annos, deletedIds:tombs};
};
Model.pctLabel = function(n){
  return Math.round((Number(n)||0)*100)+'%';
};
Model.isResolved = function(a){
  return !!(a&&(a.resolved||a.approved));
};
Model.exportPayload = function(page, annos, meta){
  page=page||{};meta=meta||{};
  var out=[],i,a;
  for(i=0;i<(annos||[]).length;i++){
    a=annos[i];if(!a) continue;
    out.push({
      id:a.id,pubId:a.pubId||'',kind:a.kind||'text',
      breadcrumb:a.breadcrumb||[],exact:a.exact||'',
      prefix:a.prefix,suffix:a.suffix,context:a.context,positionHint:a.pos,
      author:a.author||'',comment:Model.commentOf(a),
      src:a.src,srcNorm:a.srcNorm,alt:a.alt,nth:a.nth,
      xPct:a.xPct,yPct:a.yPct,wPct:a.wPct,hPct:a.hPct,
      elTag:a.elTag,elRole:a.elRole,elName:a.elName,elNth:a.elNth,elId:a.elId,
      replies:(a.replies||[]).map(function(r){
        return {id:r.id,author:r.author||'',text:r.text||'',ts:r.ts||'',resolved:!!r.resolved};
      }),
      createdAt:a.createdAt,updatedAt:a.updatedAt,
      links:meta.apiBase?{reply:Model.replyLink(meta.apiBase,page.url,a.pubId||a.id)}:undefined
    });
  }
  return {tool:'bc-annotator',version:2,exportedAt:meta.exportedAt||'',
    page:{url:page.url||'',title:page.title||''},annotations:out};
};
Model.rateRecord = function(times, now, limit, windowSec){
  var pruned=[], i, t;
  times=times||[];
  for(i=0;i<times.length;i++){
    t=+times[i];
    if((now-t)<windowSec) pruned.push(t);
  }
  if(pruned.length>=limit) return {ok:false, times:pruned};
  pruned.push(+now);
  return {ok:true, times:pruned};
};
Model.srcNorm = function(src, baseHref){
  if(!src) return '';
  try{
    var u=new URL(src, baseHref||'http://local.invalid/');
    return u.pathname;
  }catch(e){
    return String(src).split('?')[0];
  }
};
Model.filename = function(p){
  if(!p) return '';
  var parts=String(p).split('/');
  return parts[parts.length-1]||'';
};
Model.matchImages = function(imgs, a){
  if(!a) return null;
  var exact=[], i, fn;
  for(i=0;i<(imgs||[]).length;i++){
    if(imgs[i].srcNorm===a.srcNorm) exact.push(imgs[i]);
  }
  if(!exact.length){
    fn=Model.filename(a.srcNorm);
    if(fn){
      for(i=0;i<(imgs||[]).length;i++){
        if(Model.filename(imgs[i].srcNorm)===fn) exact.push(imgs[i]);
      }
    }
  }
  if(!exact.length) return null;
  var idx=a.nth||0;
  if(idx<0) idx=0;
  if(idx>=exact.length) idx=exact.length-1;
  return exact[idx];
};
Model.imagePinNumbers = function(list){
  var imgs=[], i, a, map={};
  for(i=0;i<(list||[]).length;i++){
    a=list[i];
    if(a&&a.kind==='image'&&a.id) imgs.push(a);
  }
  imgs.sort(function(x,y){
    var c=(x.createdAt||'').localeCompare(y.createdAt||'');
    return c?c:(x.id||'').localeCompare(y.id||'');
  });
  for(i=0;i<imgs.length;i++) map[imgs[i].id]=i+1;
  return map;
};
Model.allowSubmit = function(openedAt, now, honeypot){
  if(honeypot) return false;
  if((now-openedAt)<800) return false;
  return true;
};
Model.MAX_TEXT=4000;
Model.textOk = function(s){
  return String(s==null?'':s).length<=Model.MAX_TEXT;
};
Model.clampPct = function(n){
  n=Number(n);if(isNaN(n)) return 0;
  if(n<0) return 0;if(n>1) return 1;return n;
};
Model.isPinHostTag = function(tag, role, w, h, explicitOnly){
  tag=String(tag||'').toLowerCase();
  role=String(role||'').toLowerCase();
  if(!tag||tag==='html'||tag==='body'||tag==='script'||tag==='style'||tag==='noscript'||tag==='main'||tag==='img'||tag==='picture'||tag==='video') return false;
  if(tag==='button'||tag==='a'||tag==='summary'||tag==='svg'||tag==='nav'||tag==='input'||tag==='select'||tag==='textarea'||tag==='label') return true;
  if(role==='button'||role==='link'||role==='menuitem'||role==='menuitemcheckbox'||role==='tab'||role==='option'||role==='checkbox'||role==='switch'||role==='radio') return true;
  if(tag==='header'||tag==='footer'||tag==='aside'){
    h=Number(h)||0;
    return h>0 && h<=200;
  }
  if(explicitOnly) return false;
  w=Number(w)||0; h=Number(h)||0;
  return w>=24 && h>=24 && w<=720 && h<=400;
};
Model.scoreElFp = function(fp, cand){
  if(!fp||!cand) return 0;
  var ft=String(fp.tag||'').toLowerCase();
  var ct=String(cand.tag||'').toLowerCase();
  if(ft&&ct&&ft!==ct) return 0;
  var s=1;
  if(fp.id&&cand.id&&fp.id===cand.id) s+=8;
  if(fp.name){
    if(cand.name&&fp.name===cand.name) s+=4;
    else if(!(fp.id&&cand.id&&fp.id===cand.id)) s-=6;
  }
  if(fp.role&&cand.role&&fp.role===cand.role) s+=2;
  if((fp.nth||0)===(cand.nth||0)) s+=1;
  return s;
};
Model.matchElFp = function(cands, fp){
  var best=null, bs=0, i, s;
  for(i=0;i<(cands||[]).length;i++){
    s=Model.scoreElFp(fp, cands[i]);
    if(s>bs){bs=s;best=cands[i];}
  }
  if(!best||bs<3) return null;
  return best;
};
Model.elLabel = function(el){
  if(!el||el.nodeType!==1) return '';
  var lab='';
  try{lab=(el.getAttribute('aria-label')||el.getAttribute('title')||el.getAttribute('alt')||'');}catch(x){}
  lab=String(lab).replace(/\s+/g,' ').trim();
  if(lab) return lab.slice(0,80);
  var t=String(el.innerText||el.textContent||'').replace(/\s+/g,' ').trim();
  return t.slice(0,80);
};
Model.elRoleOf = function(el){
  if(!el||!el.getAttribute) return '';
  var r=el.getAttribute('role');
  if(r) return String(r).toLowerCase();
  var tag=(el.tagName||'').toLowerCase();
  if(tag==='a') return 'link';
  if(tag==='button'||tag==='summary') return 'button';
  if(tag==='input'||tag==='select'||tag==='textarea') return 'input';
  if(tag==='svg') return 'img';
  if(tag==='nav') return 'navigation';
  return '';
};
Model.isImageBox = function(a){
  return !!(a&&a.kind==='image'&&a.wPct>0.02&&a.hPct>0.02);
};
Model.pctFromClient = function(rect, clientX, clientY){
  rect=rect||{};
  var w=rect.width||1, h=rect.height||1;
  return {
    xPct:Model.clampPct((clientX-(rect.left||0))/w),
    yPct:Model.clampPct((clientY-(rect.top||0))/h)
  };
};
Model.placeImagePin = function(a, pinXPct, pinYPct){
  a=a||{};
  var x=Model.clampPct(pinXPct), y=Model.clampPct(pinYPct);
  var w=Number(a.wPct)||0, h=Number(a.hPct)||0;
  if(!Model.isImageBox(a)) return {xPct:x,yPct:y,wPct:w,hPct:h};
  var ox=x-w/2, oy=y-h/2;
  ox=Math.max(0, Math.min(1-w, ox));
  oy=Math.max(0, Math.min(1-h, oy));
  return {xPct:ox,yPct:oy,wPct:w,hPct:h};
};
Model.placeImageBox = function(a, originXPct, originYPct){
  a=a||{};
  var w=Number(a.wPct)||0, h=Number(a.hPct)||0;
  var ox=Number(originXPct)||0, oy=Number(originYPct)||0;
  ox=Math.max(0, Math.min(Math.max(0,1-w), ox));
  oy=Math.max(0, Math.min(Math.max(0,1-h), oy));
  return {xPct:ox,yPct:oy,wPct:w,hPct:h};
};
Model.normalizeUiPrefs = function(raw){
  raw=raw||{};
  var sort=raw.sort;
  if(sort!=='createdDesc'&&sort!=='pos') sort='createdAsc';
  return {sort:sort, displayName:String(raw.displayName||'').trim()};
};
Model.apiFromScriptSrc = function(src){
  if(!src) return null;
  var u=String(src).split('#')[0];
  u=u.replace(/\/index\.php(\?.*)?$/i,'/annotations.php');
  u=u.replace(/\/annotator\.js(\?.*)?$/i,'/annotations.php');
  if(/\/annotations\.php$/i.test(u.split('?')[0])) return u.split('?')[0];
  return null;
};

if(typeof module!=='undefined'&&module.exports){
  module.exports=Model;
}
if(typeof document==='undefined') return;

if(root.__bcAnnotator) return; root.__bcAnnotator=true;

var API=root.ANNOTATOR_API||Model.apiFromScriptSrc(document.currentScript&&document.currentScript.src)||null;
var docKey=location.href.split('#')[0];
var STORE_KEY='bcAnno:'+docKey;
var UI_KEY='bcAnno:ui';
var OWNER_KEY='bcAnno:ownerKey';
var HL='bc-anno-hl';
var annos=[], deletedIds=[];
var index=null,norm=null,lastText=null;
var currentTab='open';
var editPopover=null,selButton=null,toastEl=null;
var imgDrag=null,dragBox=null,skipTextSel=false;
var pinDrag=null,pinMoved=false;
var sb,fab,fabs,pinBtn,gateCb=null;
var pinMode=false,elHover=null,pinHint=null,draft=null;
var JS=JSON.stringify;

function nowISO(){return new Date().toISOString();}
function esc(s){var d=document.createElement('div');d.textContent=s==null?'':String(s);return d.innerHTML;}
function debounce(fn,ms){var t;return function(){var a=arguments;clearTimeout(t);t=setTimeout(function(){fn.apply(null,a);},ms);};}
function fmt(ts){try{return new Date(ts).toLocaleString('en-GB',{hour12:false});}catch(x){return ts;}}

function readPrefs(){
  try{return Model.normalizeUiPrefs(JSON.parse(localStorage.getItem(UI_KEY)||'{}'));}
  catch(x){return Model.normalizeUiPrefs({});}
}
function writePrefs(p){
  var n=Model.normalizeUiPrefs(p);
  try{localStorage.setItem(UI_KEY,JS(n));}catch(x){}
  return n;
}
function ownerKey(){
  var k='';
  try{k=localStorage.getItem(OWNER_KEY)||'';}catch(x){}
  if(!k){
    k=Model.uid()+Model.uid();
    try{localStorage.setItem(OWNER_KEY,k);}catch(x){}
  }
  return k;
}
function isMine(a){
  if(!a) return false;
  if(typeof a.mine==='boolean') return a.mine;
  return Model.ownsAnno(a, ownerKey());
}
function apiUrl(){
  return API+(API.indexOf('?')>-1?'&':'?')+'url='+encodeURIComponent(docKey);
}
function apiHeaders(json){
  var h={'X-Owner-Key':ownerKey()};
  if(json) h['Content-Type']='application/json';
  return h;
}

function isAnnoDom(n){
  var p=n;
  while(p){
    if(isUI(p)) return true;
    if(p.nodeType===1&&p.classList&&(p.classList.contains('bc-anno-hl')||p.classList.contains('bc-anno-imgwrap'))) return true;
    p=p.parentNode;
  }
  return false;
}
function isUI(n){
  var p=n;
  while(p){
    if(p.nodeType===1){
      if(p.hasAttribute&&p.hasAttribute('data-bc-anno-ui')) return true;
      var tg=p.tagName;
      if(tg==='SCRIPT'||tg==='STYLE'||tg==='NOSCRIPT'||tg==='TEMPLATE') return true;
    }
    p=p.parentNode;
  }
  return false;
}
function buildIndex(){
  var nodes=[],text='';
  var w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,{acceptNode:function(n){
    return (!n.nodeValue||isUI(n))?NodeFilter.FILTER_REJECT:NodeFilter.FILTER_ACCEPT;}});
  while(w.nextNode()){var t=w.currentNode;nodes.push({node:t,start:text.length,len:t.nodeValue.length});text+=t.nodeValue;}
  return {nodes:nodes,text:text};
}
function locate(off){
  var ns=index.nodes;if(!ns.length)return null;
  var lo=0,hi=ns.length-1;
  while(lo<hi){var m=(lo+hi+1)>>1;if(ns[m].start<=off)lo=m;else hi=m-1;}
  var e=ns[lo];return (off<e.start||off>e.start+e.len)?null:{node:e.node,offset:off-e.start};
}
function pointOffset(container,offset){
  if(container.nodeType===3){for(var i=0;i<index.nodes.length;i++){if(index.nodes[i].node===container)return index.nodes[i].start+offset;}return null;}
  var probe=document.createRange();
  try{probe.setStart(container,Math.min(offset,container.childNodes.length));}catch(x){return null;}
  probe.collapse(true);
  for(var j=0;j<index.nodes.length;j++){var c;try{c=probe.comparePoint(index.nodes[j].node,0);}catch(x){continue;}
    if(c===0)return index.nodes[j].start+offset;
    if(c>0)return index.nodes[j].start;}
  return index.text.length;
}
function allOcc(hay,needle){var res=[],i=0;while((i=hay.indexOf(needle,i))!==-1){res.push(i);i+=Math.max(1,needle.length>>1);}return res;}
function nearestTo(pos,list){var b=list[0],bd=Math.abs(list[0]-pos);for(var i=1;i<list.length;i++){var d=Math.abs(list[i]-pos);if(d<bd){bd=d;b=list[i];}}return b;}
function bigrams(s){var r={},n=s.length-1;for(var i=0;i<n;i++){var g=s.substr(i,2);r[g]=(r[g]||0)+1;}return r;}
function dice(a,b){if(a.length<2||b.length<2)return 0;var A=bigrams(a),B=bigrams(b),sa=0,sb=0,t=0,k;
  for(k in A){sa+=A[k];t+=Math.min(A[k],B[k]||0);}for(k in B)sb+=B[k];
  return (sa&&sb)?(2*t/(sa+sb)):0;}
function buildNorm(){
  var s=index.text,map=[],out='';
  for(var i=0;i<s.length;i++){var ch=s.charAt(i);
    if(/\s/.test(ch)){if(out.length&&out.charAt(out.length-1)!==' '){out+=' ';map.push(i);}}
    else{var lo=ch.toLowerCase();out+=lo;map.push(i);}}
  norm={text:out,map:map};
}
function resolveAnchor(a){
  var ex=a.exact||'';if(ex.length<2)return null;
  var occ=allOcc(index.text,ex);
  if(occ.length){var p=nearestTo(a.pos||0,occ);return{start:p,end:p+ex.length,q:'anchored'};}
  if(!norm)buildNorm();
  var nx=ex.toLowerCase().replace(/\s+/g,' ').trim();
  var no=allOcc(norm.text,nx);
  if(no.length){var pn=nearestTo(a.pos||0,no);
    if(pn+nx.length<=norm.map.length){var os=norm.map[pn],oe=norm.map[pn+nx.length-1]+1;return{start:os,end:oe,q:'fuzzy'};}}
  var L=ex.length,best=null,bs=0.75,from=Math.max(0,(a.pos||0)-2500),to=Math.min(index.text.length-L,from+5000);
  for(var w=from;w<=to;w+=20){var s=dice(nx,index.text.substr(w,L).toLowerCase());if(s>bs){bs=s;best=w;}}
  return best!==null?{start:best,end:best+L,q:'fuzzy'}:null;
}
function crumbFromEl(el){
  if(!el)return[];
  var hs=document.body.querySelectorAll('h1,h2,h3,h4,h5,h6'),out=[],i,h,lvl;
  for(i=0;i<hs.length;i++){
    h=hs[i];
    if(h.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING){
      lvl=+h.tagName.charAt(1);
      while(out.length&&out[out.length-1].lvl>=lvl)out.pop();
      out.push({lvl:lvl,t:h.textContent.trim().slice(0,100)});
    }else break;
  }
  return out.map(function(x){return x.t;});
}
function crumb(start){
  var p=locate(start);if(!p)return[];
  return crumbFromEl(p.node.parentElement);
}
function captureFromSelection(sel){
  var r=sel.getRangeAt(0);
  var start=pointOffset(r.startContainer,r.startOffset);
  var end=pointOffset(r.endContainer,r.endOffset);
  if(start==null||end==null||end-start<2)return null;
  var exact=index.text.substring(start,end);
  if(exact.trim().length<2)return null;
  return {id:Model.uid(),kind:'text',pos:start,exact:exact,
    prefix:index.text.substring(Math.max(0,start-40),start),
    suffix:index.text.substring(end,Math.min(index.text.length,end+40)),
    breadcrumb:crumb(start),
    context:index.text.substring(Math.max(0,start-160),Math.min(index.text.length,end+160)),
    status:'open',resolved:false,approved:false,anchorQ:null,_range:null,
    author:'',replies:[],edits:[],ownerId:ownerKey(),mine:true,pubId:Model.nextPubId(annos),
    createdAt:nowISO(),updatedAt:nowISO()};
}
function pageImages(){
  var imgs=document.body.querySelectorAll('img'),out=[],counts={},i,src,n;
  for(i=0;i<imgs.length;i++){
    if(isUI(imgs[i])) continue;
    src=imgs[i].currentSrc||imgs[i].src||'';
    n=Model.srcNorm(src, location.href);
    counts[n]=counts[n]||0;
    out.push({el:imgs[i],src:src,srcNorm:n,alt:imgs[i].alt||'',nth:counts[n]});
    counts[n]++;
  }
  return out;
}
function captureFromImage(img,xPct,yPct,wPct,hPct){
  var src=img.currentSrc||img.src||'';
  var nrm=Model.srcNorm(src, location.href);
  var listed=pageImages(), hit=null,i;
  for(i=0;i<listed.length;i++){if(listed[i].el===img){hit=listed[i];break;}}
  return {id:Model.uid(),kind:'image',pos:0,exact:'',
    src:src,srcNorm:nrm,alt:img.alt||'',nth:hit?hit.nth:0,
    xPct:Model.clampPct(xPct),yPct:Model.clampPct(yPct),
    wPct:Model.clampPct(wPct),hPct:Model.clampPct(hPct),
    breadcrumb:crumbFromEl(img),context:'',
    status:'open',resolved:false,approved:false,anchorQ:null,
    author:'',replies:[],edits:[],ownerId:ownerKey(),mine:true,pubId:Model.nextPubId(annos),
    createdAt:nowISO(),updatedAt:nowISO()};
}

function clearHl(){
  var sps=document.querySelectorAll('.'+HL),i,sp,p;
  for(i=0;i<sps.length;i++){sp=sps[i];p=sp.parentNode;if(!p)continue;
    while(sp.firstChild)p.insertBefore(sp.firstChild,sp);
    p.removeChild(sp);try{p.normalize();}catch(x){}}
}
function clearImgMarks(){
  var marks=document.querySelectorAll('.bc-anno-pin:not(.bc-anno-draft),.bc-anno-ibox:not(.bc-anno-draft)'),i,m;
  for(i=0;i<marks.length;i++){m=marks[i];if(m.parentNode)m.parentNode.removeChild(m);}
  var wraps=document.querySelectorAll('.bc-anno-imgwrap'),w,img;
  for(i=0;i<wraps.length;i++){
    w=wraps[i];
    if(w.querySelector('.bc-anno-draft')) continue;
    img=w.querySelector('img');
    if(img&&w.parentNode){w.parentNode.insertBefore(img,w);w.parentNode.removeChild(w);}
  }
}
function clearElPins(){
  var marks=document.querySelectorAll('.bc-anno-elpin:not(.bc-anno-draft)'),i,m;
  for(i=0;i<marks.length;i++){m=marks[i];if(m.parentNode)m.parentNode.removeChild(m);}
}
function elNth(el){
  var tag=(el.tagName||'').toLowerCase();
  var name=Model.elLabel(el);
  var n=el, nth=0;
  while((n=n.previousElementSibling)){
    if((n.tagName||'').toLowerCase()!==tag) continue;
    if(Model.elLabel(n)===name) nth++;
  }
  return nth;
}
function pageElHosts(){
  var all=document.body.getElementsByTagName('*'), out=[], i, el, tag, role, w, h;
  for(i=0;i<all.length;i++){
    el=all[i];
    if(isUI(el)) continue;
    tag=(el.tagName||'').toLowerCase();
    role=Model.elRoleOf(el);
    w=el.offsetWidth||0; h=el.offsetHeight||0;
    if(!Model.isPinHostTag(tag, role, w, h)) continue;
    out.push({el:el, tag:tag, role:role, name:Model.elLabel(el), nth:elNth(el), id:el.id||''});
  }
  return out;
}
function fromImgClick(n){
  if(!n) return false;
  if(n.nodeType===3) n=n.parentElement;
  if(!n||!n.closest) return false;
  var img=n.nodeType===1?n.closest('img'):null;
  return !!img;
}
function pickPinHost(start){
  var n=start, i=0, tag, role, w, h, explicitOnly=fromImgClick(start);
  if(n&&n.nodeType===3) n=n.parentElement;
  while(n&&n.nodeType===1&&i++<24){
    if(n.getAttribute&&n.getAttribute('data-bc-anno-ui')) return null;
    tag=(n.tagName||'').toLowerCase();
    if(tag==='img'||tag==='picture'||tag==='video'){n=n.parentElement;continue;}
    role=Model.elRoleOf(n);
    w=n.offsetWidth||0; h=n.offsetHeight||0;
    if(Model.isPinHostTag(tag, role, w, h, explicitOnly)) return n;
    n=n.parentElement;
  }
  return null;
}
function placeElPinMark(mark, el, a){
  var r=el.getBoundingClientRect();
  var x=r.left+(Number(a.xPct)||0.5)*r.width;
  var y=r.top+(Number(a.yPct)||0.5)*r.height;
  mark.style.left=Math.round(x)+'px';
  mark.style.top=Math.round(y)+'px';
}
function syncElPins(){
  var marks=document.querySelectorAll('.bc-anno-elpin'), i, mark, id, a;
  for(i=0;i<marks.length;i++){
    mark=marks[i];
    id=mark.getAttribute('data-anno');
    a=annos.find(function(x){return x.id===id;});
    if(!a||!a._el) continue;
    placeElPinMark(mark, a._el, a);
  }
  if(elHover&&elHover._el) showElHover(elHover._el);
  paintDraft();
}
function captureFromEl(el, cx, cy){
  var r=el.getBoundingClientRect();
  var p=Model.pctFromClient(r, cx, cy);
  return {id:Model.uid(),kind:'el',pos:0,exact:Model.elLabel(el),
    elTag:(el.tagName||'').toLowerCase(),elRole:Model.elRoleOf(el),
    elName:Model.elLabel(el),elNth:elNth(el),elId:el.id||'',
    xPct:p.xPct,yPct:p.yPct,wPct:0,hPct:0,
    breadcrumb:crumbFromEl(el),context:'',
    status:'open',resolved:false,approved:false,anchorQ:null,
    author:'',replies:[],edits:[],ownerId:ownerKey(),mine:true,pubId:Model.nextPubId(annos),
    createdAt:nowISO(),updatedAt:nowISO()};
}
function ensureImgWrap(img){
  if(img.parentNode&&img.parentNode.classList&&img.parentNode.classList.contains('bc-anno-imgwrap')) return img.parentNode;
  var w=document.createElement('span'), cs, d;
  w.className='bc-anno-imgwrap';
  try{cs=window.getComputedStyle(img);}catch(x){cs=null;}
  d=cs&&cs.display?cs.display:'inline-block';
  w.style.display=(d==='block'||d==='flex'||d==='grid')?'block':'inline-block';
  if(cs&&cs.verticalAlign) w.style.verticalAlign=cs.verticalAlign;
  img.parentNode.insertBefore(w,img);w.appendChild(img);return w;
}
function renderHl(){
  clearHl();clearImgMarks();clearElPins();
  var pinNos=Model.imagePinNumbers(annos);
  var i,a,res,j,e,s,en,seg,sp,hit,wrap,mark,isBox,n;
  for(i=0;i<annos.length;i++){
    a=annos[i];
    if(a.status==='done') continue;
    if(a.kind==='image'){
      hit=Model.matchImages(pageImages(),a);
      a.anchorQ=hit?'anchored':'orphaned';
      a._imgEl=hit?hit.el:null;
      if(!hit) continue;
      wrap=ensureImgWrap(hit.el);
      isBox=Model.isImageBox(a);
      n=a.pubId||pinNos[a.id]||'';
      if(isBox){
        mark=document.createElement('span');
        mark.className='bc-anno-ibox';
        mark.setAttribute('data-anno',a.id);
        mark.setAttribute('data-bc-anno-ui','1');
        mark.style.left=(a.xPct*100)+'%';
        mark.style.top=(a.yPct*100)+'%';
        mark.style.width=(a.wPct*100)+'%';
        mark.style.height=(a.hPct*100)+'%';
        wrap.appendChild(mark);
      }
      mark=document.createElement('span');
      mark.className='bc-anno-pin';
      mark.setAttribute('data-anno',a.id);
      mark.setAttribute('data-bc-anno-ui','1');
      mark.setAttribute('title','Pin '+n);
      mark.textContent=String(n);
      mark.style.left=((isBox?(a.xPct+a.wPct/2):a.xPct)*100)+'%';
      mark.style.top=((isBox?(a.yPct+a.hPct/2):a.yPct)*100)+'%';
      wrap.appendChild(mark);
      continue;
    }
    if(a.kind==='el'){
      hit=Model.matchElFp(pageElHosts(),{tag:a.elTag,role:a.elRole,name:a.elName,nth:a.elNth,id:a.elId});
      a.anchorQ=hit?'anchored':'orphaned';
      a._el=hit?hit.el:null;
      if(!hit) continue;
      mark=document.createElement('span');
      mark.className='bc-anno-pin bc-anno-elpin';
      mark.setAttribute('data-anno',a.id);
      mark.setAttribute('data-bc-anno-ui','1');
      n=a.pubId||'';
      mark.setAttribute('title','Pin '+n);
      mark.textContent=String(n);
      document.body.appendChild(mark);
      placeElPinMark(mark, hit.el, a);
      continue;
    }
    res=resolveAnchor(a);a.anchorQ=res?res.q:'orphaned';a._range=res;
    if(!res) continue;
    for(j=0;j<index.nodes.length;j++){
      e=index.nodes[j];
      if(e.start>=res.end||e.start+e.len<=res.start) continue;
      if(!e.node.parentNode||isUI(e.node)) continue;
      s=Math.max(res.start,e.start);en=Math.min(res.end,e.start+e.len);
      seg=document.createRange();
      try{seg.setStart(e.node,s-e.start);seg.setEnd(e.node,en-e.start);}catch(x){continue;}
      sp=document.createElement('span');sp.className=HL;sp.setAttribute('data-anno',a.id);
      try{seg.surroundContents(sp);}catch(x){}
    }
  }
}
function refresh(){
  index=buildIndex();norm=null;lastText=index.text;
  renderHl();
  index=buildIndex();norm=null;lastText=index.text;
  renderList();
  paintDraft();
}

function injectStyle(){
  var st=document.createElement('style');st.setAttribute('data-bc-anno-ui','1');
  st.textContent=
  '[data-bc-anno-ui],[data-bc-anno-ui] *,[data-bc-anno-ui]::before,[data-bc-anno-ui]::after,[data-bc-anno-ui] *::before,[data-bc-anno-ui] *::after{box-sizing:border-box;}'+
  '.bc-anno-sb,.bc-anno-ed,.bc-anno-fabs,.bc-anno-toast,.bc-anno-selbtn,.bc-anno-elhover,.bc-anno-dragbox,.bc-anno-pin,.bc-anno-ibox,.bc-anno-elpin,.bc-anno-draft-hl{'+
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'+
    'font-size:13px;line-height:1.5;font-weight:400;font-style:normal;letter-spacing:normal;text-transform:none;text-shadow:none;color:#111;isolation:isolate;}'+
  '.bc-anno-sb button,.bc-anno-ed button,.bc-anno-selbtn,.bc-anno-fab,.bc-anno-gate button,.bc-anno-acts button,.bc-anno-reply button,'+
  '.bc-anno-sb select,.bc-anno-sb input,.bc-anno-ed input,.bc-anno-ed textarea,.bc-anno-item textarea,.bc-anno-gate input{'+
    'appearance:none;-webkit-appearance:none;font:inherit;color:inherit;background:transparent;border:none;box-shadow:none;outline:none;margin:0;padding:0;max-width:none;min-width:0;width:auto;height:auto;border-radius:0;letter-spacing:normal;text-transform:none;line-height:inherit;}'+
  '.bc-anno-sb a,.bc-anno-ed a{color:inherit;text-decoration:none;background:transparent;}'+
  '.bc-anno-hl{display:inline;background:rgba(255,86,0,.18);border-bottom:2px solid #FF5600;border-radius:2px;cursor:pointer;}'+
  '.bc-anno-hl.bc-flash{animation:bcAnnoFlash 1.2s ease;}'+
  '@keyframes bcAnnoFlash{0%,100%{background:rgba(255,86,0,.18)}30%{background:rgba(255,86,0,.45)}}'+
  '.bc-anno-imgwrap{position:relative;}'+
  '.bc-anno-pin{position:absolute;min-width:26px;height:22px;padding:0 5px;margin:-11px 0 0 -13px;display:flex;align-items:center;justify-content:center;background:#FF5600;border:2px solid #fff;border-radius:999px;box-shadow:0 4px 12px rgba(255,86,0,.35);cursor:grab;z-index:6;pointer-events:auto;color:#fff;font:700 9px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;user-select:none;box-sizing:border-box;letter-spacing:.02em;}'+
  '.bc-anno-elpin{position:fixed;z-index:2147482990;cursor:pointer;margin:-11px 0 0 -13px;}'+
  '.bc-anno-elhover{position:fixed;z-index:2147482988;border:2px solid #FF5600;border-radius:12px;background:rgba(255,86,0,.1);pointer-events:none;box-sizing:border-box;}'+
  '.bc-anno-draft{pointer-events:none !important;cursor:default !important;}'+
  '.bc-anno-draft-hl{position:fixed;z-index:2147482994;background:rgba(255,86,0,.22);border-bottom:2px solid #FF5600;border-radius:2px;pointer-events:none;}'+
  'body.bc-anno-pinmode,body.bc-anno-pinmode *{cursor:crosshair !important;}'+
  'body.bc-anno-pinmode [data-bc-anno-ui],body.bc-anno-pinmode [data-bc-anno-ui] *{cursor:pointer !important;}'+
  '.bc-anno-pinhint{bottom:72px;background:#111;}'+
  '.bc-anno-ibox{position:absolute;border:2px solid #FF5600;background:rgba(255,86,0,.16);cursor:grab;z-index:5;box-sizing:border-box;border-radius:8px;}'+
  '.bc-anno-pin.bc-drag,.bc-anno-ibox.bc-drag{cursor:grabbing;z-index:8;}'+
  '.bc-anno-dragbox{position:fixed;border:1.5px dashed #FF5600;background:rgba(255,86,0,.1);z-index:2147483003;pointer-events:none;border-radius:10px;}'+
  '.bc-anno-sb{position:fixed;right:16px;bottom:16px;width:400px;max-width:calc(100vw - 24px);height:80vh;max-height:80vh;background:#fff;border:1px solid #D3CEC6;border-radius:24px;box-shadow:0 12px 40px rgba(17,17,17,.12);z-index:2147483000;display:flex;flex-direction:column;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;overflow:hidden;}'+
  '.bc-anno-sb.bc-hide{opacity:0;pointer-events:none;visibility:hidden;transform:translate(12px,16px);}'+
  '.bc-anno-sb-h{padding:12px 10px 12px 14px;background:#fff;color:#111;flex:none;display:flex;align-items:center;gap:6px;border-bottom:1px solid #EBE7E1;}'+
  '.bc-anno-sb-h select,.bc-anno-sb-h button:not(.bc-anno-x){font-size:11px;padding:6px 10px;border-radius:999px;border:none;background:#F5F1EC;color:#111;cursor:pointer;font-weight:600;}'+
  '.bc-anno-sb-h button:not(.bc-anno-x):hover,.bc-anno-sb-h select:hover{background:#EBE7E1;}'+
  '.bc-anno-sb-h .bc-anno-x{margin-left:auto;cursor:pointer;background:none;border:none;color:#626260;font-size:18px;padding:4px 8px;line-height:1;border-radius:999px;}'+
  '.bc-anno-sb-h .bc-anno-x:hover{background:#F5F1EC;color:#111;}'+
  '.bc-anno-list{flex:1;overflow-y:auto;padding:14px;min-height:0;background:#fff;}'+
  '.bc-anno-item{border:none;border-radius:16px;padding:12px 14px;margin-bottom:10px;background:#F5F1EC;cursor:pointer;}'+
  '.bc-anno-item:hover{background:#EBE7E1;}'+
  '.bc-anno-who{font-size:12px;font-weight:700;color:#111;margin-bottom:2px;display:flex;align-items:center;gap:8px;}'+
  '.bc-anno-pinno{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:20px;padding:0 6px;background:#FF5600;color:#fff;border-radius:999px;font-size:10px;font-weight:700;letter-spacing:.02em;}'+
  '.bc-anno-crumb{font-size:11px;color:#626260;margin-bottom:4px;word-break:break-word;}'+
  '.bc-anno-ex{font-size:12px;color:#626260;font-style:normal;border-left:2px solid #FF5600;padding-left:8px;margin:4px 0 6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'+
  '.bc-anno-cm{font-size:13px;white-space:pre-wrap;word-break:break-word;color:#111;}'+
  '.bc-anno-mt{font-size:11px;color:#7B7B78;margin-top:8px;display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;}'+
  '.bc-anno-badge{font-size:10.5px;font-weight:600;border-radius:999px;padding:2px 8px;background:#EBE7E1;color:#626260;}'+
  '.bc-anno-badge.bc-anno-ok{background:rgba(11,223,80,.18);color:#0A7A32;}'+
  '.bc-anno-badge.bc-anno-fz{background:#FFF1E8;color:#FF5600;}'+
  '.bc-anno-badge.bc-anno-or{background:rgba(255,32,103,.12);color:#C41C1C;}'+
  '.bc-anno-badge.bc-anno-ap{background:rgba(0,7,203,.08);color:#0007CB;}'+
  '.bc-anno-acts{display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;}'+
  '.bc-anno-acts button{font-size:11.5px;padding:5px 12px;border-radius:999px;border:none;background:#fff;color:#111;cursor:pointer;font-weight:600;}'+
  '.bc-anno-acts button:hover{background:#EBE7E1;}'+
  '.bc-anno-acts button.bc-anno-pri{background:#111;border:none;color:#fff;}'+
  '.bc-anno-acts button.bc-anno-pri:hover{background:#313130;}'+
  '.bc-anno-acts button.bc-anno-dz:hover{background:#FF2067;color:#fff;}'+
  '.bc-anno-item textarea{width:100%;min-height:58px;border:none;border-radius:12px;padding:10px;font:13px/1.5 inherit;box-sizing:border-box;background:#fff;}'+
  '.bc-anno-replies{max-height:120px;overflow-y:auto;margin-top:8px;padding:8px 10px;background:#fff;border-radius:12px;}'+
  '.bc-anno-reply{font-size:12px;margin:0 0 6px;word-break:break-word;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}'+
  '.bc-anno-rt{min-width:0;flex:1;}'+
  '.bc-anno-reply button{flex:none;font-size:10.5px;padding:3px 8px;border-radius:999px;border:none;background:#F5F1EC;color:#111;cursor:pointer;font-weight:600;}'+
  '.bc-anno-ra{font-weight:700;color:#0007CB;}'+
  '.bc-anno-empty{text-align:center;color:#626260;font-size:13px;padding:36px 12px;}'+
  '.bc-anno-ft{flex:none;padding:8px 12px 8px 16px;border-top:1px solid #EBE7E1;font-size:11px;color:#7B7B78;display:flex;align-items:center;gap:10px;}'+
  '.bc-anno-ft-h{min-width:0;flex:1;}'+
  '.bc-anno-ft-i{flex:none;width:22px;height:22px;display:inline-flex;align-items:center;justify-content:center;color:#7B7B78;text-decoration:none;border-radius:999px;}'+
  '.bc-anno-ft-i svg{display:block;width:16px;height:16px;}'+
  '.bc-anno-ft-i:hover{color:#111;background:#F5F1EC;}'+
  '.bc-anno-gate{padding:18px 16px;}'+
  '.bc-anno-gate p{margin:0 0 10px;font-size:13px;color:#626260;}'+
  '.bc-anno-gate input{width:100%;box-sizing:border-box;border:none;border-radius:12px;padding:10px 12px;font:13px/1.5 inherit;background:#F5F1EC;}'+
  '.bc-anno-gate button{margin-top:12px;background:#FF5600;color:#fff;border:none;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer;}'+
  '.bc-anno-fabs{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:0;background:#fff;border:1px solid #D3CEC6;border-radius:999px;padding:2px;box-shadow:0 6px 20px rgba(17,17,17,.12);overflow:visible;}'+
  '.bc-anno-fab{position:relative;width:42px;height:42px;display:flex;align-items:center;justify-content:center;background:transparent;color:#111;border:none;border-radius:999px;padding:0;font-size:0;cursor:pointer;box-shadow:none;outline:none;}'+
  '.bc-anno-fab:hover,.bc-anno-fab:focus,.bc-anno-fab:active,.bc-anno-fab-pin:hover,.bc-anno-fab-pin:focus,.bc-anno-fab-pin.bc-on,.bc-anno-fab-pin.bc-on:hover{background:transparent;color:#111;outline:none;}'+
  '.bc-anno-fab-pin,.bc-anno-fab-pin.bc-on{color:#111;background:transparent;}'+
  '.bc-anno-fab + .bc-anno-fab{position:relative;}'+
  '.bc-anno-fab + .bc-anno-fab::before{content:"";position:absolute;left:0;top:10px;bottom:10px;width:1px;background:#EBE7E1;pointer-events:none;}'+
  '.bc-anno-fab-ic{display:flex;width:22px;height:22px;}'+
  '.bc-anno-fab-ic svg{display:block;width:22px;height:22px;}'+
  '.bc-anno-fab-n{position:absolute;top:2px;right:2px;min-width:18px;height:18px;padding:0 4px;background:#FF5600;color:#fff;border:2px solid #fff;border-radius:999px;font:700 11px/14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;display:none;align-items:center;justify-content:center;box-sizing:border-box;z-index:1;pointer-events:none;}'+
  '.bc-anno-fab-n.bc-show{display:flex;}'+
  '.bc-anno-selbtn{position:fixed;z-index:2147483001;background:#FF5600;color:#fff;border:none;border-radius:999px;padding:7px 14px;font-size:12.5px;font-weight:600;cursor:pointer;box-shadow:0 8px 24px rgba(255,86,0,.28);}'+
  '.bc-anno-ed{position:fixed;z-index:2147483002;background:#fff;border:1px solid #D3CEC6;border-radius:20px;box-shadow:0 12px 40px rgba(17,17,17,.14);padding:16px;width:320px;max-width:92vw;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:#111;}'+
  '.bc-anno-ed h4{margin:0 0 10px;font-size:14px;font-weight:700;color:#111;}'+
  '.bc-anno-ed textarea,.bc-anno-ed input[type=text]{width:100%;min-height:74px;border:none;border-radius:12px;padding:10px 12px;font:13px/1.5 inherit;box-sizing:border-box;margin-bottom:8px;background:#F5F1EC;}'+
  '.bc-anno-ed input[type=text]{min-height:0;}'+
  '.bc-anno-ed textarea:focus,.bc-anno-ed input:focus{outline:2px solid rgba(255,86,0,.35);outline-offset:0;background:#fff;}'+
  '.bc-anno-row{display:flex;gap:8px;justify-content:flex-end;margin-top:8px;}'+
  '.bc-anno-ed button{font-size:12.5px;padding:7px 14px;border-radius:999px;border:none;background:#F5F1EC;cursor:pointer;font-weight:600;color:#111;}'+
  '.bc-anno-ed button.bc-anno-pri{background:#FF5600;color:#fff;}'+
  '.bc-anno-ed button.bc-anno-pri:hover{background:#FE4C02;}'+
  '.bc-anno-hp{position:absolute;left:-10000px;width:1px;height:1px;opacity:0;}'+
  '.bc-anno-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#111;color:#fff;padding:8px 14px;border-radius:999px;z-index:2147483004;font:12.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;box-shadow:0 8px 24px rgba(17,17,17,.16);}'+
  '@media (max-width:767px){.bc-anno-sb{left:0;right:0;top:0;bottom:0;width:100%;max-width:none;height:auto;max-height:none;border-radius:0;}.bc-anno-sb.bc-hide{transform:translateY(12px);}.bc-anno-fabs{bottom:12px;right:12px;}}';
  (document.body||document.head).appendChild(st);
}

function panelOpen(){return sb&&!sb.classList.contains('bc-hide');}
function syncGate(){
  var named=!!readPrefs().displayName;
  var g=sb.querySelector('.bc-anno-gate');
  var list=sb.querySelector('.bc-anno-list');
  if(!g||!list) return;
  g.hidden=named;
  g.style.display=named?'none':'block';
  list.style.display=named?'':'none';
}
function openPanel(){
  setPinMode(false);
  sb.classList.remove('bc-hide');
  if(fabs) fabs.style.display='none';
  syncGate();renderList();
}
function closePanel(){
  sb.classList.add('bc-hide');
  if(fabs) fabs.style.display='';
  gateCb=null;
}
function togglePanel(){if(panelOpen()) closePanel(); else openPanel();}
function toast(msg){
  if(toastEl){toastEl.remove();toastEl=null;}
  toastEl=document.createElement('div');toastEl.className='bc-anno-toast';
  toastEl.setAttribute('data-bc-anno-ui','1');toastEl.textContent=msg;
  document.body.appendChild(toastEl);
  setTimeout(function(){if(toastEl){toastEl.remove();toastEl=null;}},1600);
}
function showPinHint(){
  if(pinHint) return;
  pinHint=document.createElement('div');pinHint.className='bc-anno-toast bc-anno-pinhint';
  pinHint.setAttribute('data-bc-anno-ui','1');
  pinHint.textContent='Click a menu, button, or shape. Esc to cancel.';
  document.body.appendChild(pinHint);
}
function hidePinHint(){
  if(pinHint){pinHint.remove();pinHint=null;}
}
function showElHover(el){
  if(!el){hideElHover();return;}
  if(!elHover){
    elHover=document.createElement('div');elHover.className='bc-anno-elhover';
    elHover.setAttribute('data-bc-anno-ui','1');
    document.body.appendChild(elHover);
  }
  elHover._el=el;
  var r=el.getBoundingClientRect();
  elHover.style.left=Math.round(r.left)+'px';
  elHover.style.top=Math.round(r.top)+'px';
  elHover.style.width=Math.round(r.width)+'px';
  elHover.style.height=Math.round(r.height)+'px';
}
function hideElHover(){
  if(elHover){elHover.remove();elHover=null;}
}
function clearDraftPaint(){
  var nodes=document.querySelectorAll('.bc-anno-draft'), i, n;
  for(i=0;i<nodes.length;i++){n=nodes[i];if(n.parentNode)n.parentNode.removeChild(n);}
}
function clearDraft(){
  draft=null;
  clearDraftPaint();
}
function paintDraftText(range){
  var rects, i, r, el, n;
  if(!range) return;
  try{rects=range.getClientRects();}catch(x){return;}
  n=Math.min(rects.length,48);
  for(i=0;i<n;i++){
    r=rects[i];
    if(!r.width||!r.height) continue;
    el=document.createElement('div');
    el.className='bc-anno-draft bc-anno-draft-hl';
    el.setAttribute('data-bc-anno-ui','1');
    el.style.left=Math.round(r.left)+'px';
    el.style.top=Math.round(r.top)+'px';
    el.style.width=Math.round(r.width)+'px';
    el.style.height=Math.round(r.height)+'px';
    document.body.appendChild(el);
  }
}
function paintDraftEl(el, xPct, yPct){
  var mark;
  if(!el) return;
  showElHover(el);
  mark=document.createElement('span');
  mark.className='bc-anno-pin bc-anno-elpin bc-anno-draft';
  mark.setAttribute('data-bc-anno-ui','1');
  mark.textContent='+';
  document.body.appendChild(mark);
  placeElPinMark(mark, el, {xPct:xPct, yPct:yPct});
}
function paintDraftImage(img, xPct, yPct, wPct, hPct){
  var wrap, mark, isBox;
  if(!img) return;
  wrap=ensureImgWrap(img);
  isBox=wPct>0.02&&hPct>0.02;
  if(isBox){
    mark=document.createElement('span');
    mark.className='bc-anno-ibox bc-anno-draft';
    mark.setAttribute('data-bc-anno-ui','1');
    mark.style.left=(xPct*100)+'%';
    mark.style.top=(yPct*100)+'%';
    mark.style.width=(wPct*100)+'%';
    mark.style.height=(hPct*100)+'%';
    wrap.appendChild(mark);
  }
  mark=document.createElement('span');
  mark.className='bc-anno-pin bc-anno-draft';
  mark.setAttribute('data-bc-anno-ui','1');
  mark.textContent='+';
  mark.style.left=((isBox?(xPct+wPct/2):xPct)*100)+'%';
  mark.style.top=((isBox?(yPct+hPct/2):yPct)*100)+'%';
  wrap.appendChild(mark);
}
function paintDraft(){
  clearDraftPaint();
  if(!draft) return;
  if(draft.kind==='text') paintDraftText(draft.range);
  else if(draft.kind==='el') paintDraftEl(draft.el, draft.xPct, draft.yPct);
  else if(draft.kind==='image') paintDraftImage(draft.img, draft.xPct, draft.yPct, draft.wPct, draft.hPct);
}
function setDraft(next){
  draft=next||null;
  paintDraft();
  if(draft) hidePinHint();
  else if(pinMode) showPinHint();
}
function setPinMode(on){
  on=!!on;
  if(on&&panelOpen()) closePanel();
  pinMode=on;
  hidePopovers();
  if(document.body) document.body.classList.toggle('bc-anno-pinmode', on);
  if(pinBtn){
    pinBtn.classList.toggle('bc-on', on);
    pinBtn.setAttribute('aria-pressed', on?'true':'false');
  }
  hideElHover();
  if(on) showPinHint();
  else hidePinHint();
}

function buildUI(){
  sb=document.createElement('div');sb.className='bc-anno-sb bc-hide';sb.setAttribute('data-bc-anno-ui','1');
  sb.innerHTML=
  '<div class="bc-anno-sb-h">'+
    '<select data-tab>'+
      '<option value="open">Open</option>'+
      '<option value="done">Done</option>'+
    '</select>'+
    '<select data-sort>'+
      '<option value="createdAsc">Newest at bottom</option>'+
      '<option value="createdDesc">Newest at top</option>'+
      '<option value="pos">By page position</option>'+
    '</select>'+
    '<button type="button" data-export>Export</button>'+
    '<button type="button" data-import>Import</button>'+
    '<button type="button" class="bc-anno-x" data-x>&#10005;</button>'+
  '</div>'+
  '<div class="bc-anno-gate">'+
    '<p>Enter your name before viewing the note list.</p>'+
    '<input type="text" data-name-input placeholder="Display name" maxlength="80">'+
    '<button type="button" data-name-save>Save name</button>'+
  '</div>'+
  '<div class="bc-anno-list"></div>'+
  '<div class="bc-anno-ft">'+
    '<span class="bc-anno-ft-h">Select text, Pin a control, or click / drag an image | Alt+N | Esc</span>'+
    '<a class="bc-anno-ft-i" href="https://bluecoral.vn" target="_blank" rel="noopener noreferrer" title="Blue Coral" aria-label="Blue Coral">'+
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11.2V16"/><path d="M12 8h.01"/></svg>'+
    '</a>'+
  '</div>';
  document.body.appendChild(sb);

  fabs=document.createElement('div');fabs.className='bc-anno-fabs';fabs.setAttribute('data-bc-anno-ui','1');
  pinBtn=document.createElement('button');pinBtn.type='button';pinBtn.className='bc-anno-fab bc-anno-fab-pin';
  pinBtn.setAttribute('data-bc-anno-ui','1');pinBtn.setAttribute('aria-label','Click a control');
  pinBtn.setAttribute('aria-pressed','false');
  pinBtn.setAttribute('title','Click a control');
  pinBtn.innerHTML='<span class="bc-anno-fab-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 17v5"/><path d="M8 3h8"/><path d="M9 3v7L6 14h12l-3-4V3"/></svg></span>';
  pinBtn.onclick=function(ev){ev.stopPropagation();setPinMode(!pinMode);};
  fab=document.createElement('button');fab.type='button';fab.className='bc-anno-fab';fab.setAttribute('data-bc-anno-ui','1');
  fab.setAttribute('aria-label','Open notes');
  fab.setAttribute('title','Notes');
  fab.innerHTML='<span class="bc-anno-fab-ic" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3.5h6.2L18.5 8v12.2a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z"/><path d="M14.2 3.5V8h4.3"/><path d="M10 12h5.2M10 15.4h5.2"/></svg></span><span class="bc-anno-fab-n" aria-hidden="true"></span>';
  fab.onclick=function(){openPanel();};
  fabs.appendChild(pinBtn);fabs.appendChild(fab);
  document.body.appendChild(fabs);

  sb.querySelector('[data-x]').onclick=closePanel;
  sb.querySelector('[data-tab]').onchange=function(){currentTab=this.value;renderList();};
  var sortEl=sb.querySelector('[data-sort]');
  sortEl.value=readPrefs().sort;
  sortEl.onchange=function(){
    var p=readPrefs();p.sort=sortEl.value;writePrefs(p);renderList();
  };
  sb.querySelector('[data-export]').onclick=exportJSON;
  sb.querySelector('[data-import]').onclick=function(){imp.click();};
  sb.querySelector('[data-name-save]').onclick=saveNameFromGate;
  sb.querySelector('[data-name-input]').addEventListener('keydown',function(e){
    if(e.key==='Enter') saveNameFromGate();
  });

  var imp=document.createElement('input');imp.type='file';imp.accept='.json,application/json';
  imp.style.display='none';imp.setAttribute('data-bc-anno-ui','1');sb.appendChild(imp);
  imp.onchange=function(){var f=imp.files[0];if(!f)return;var rd=new FileReader();
    rd.onload=function(){try{var d=JSON.parse(rd.result);
      ingestDoc(Array.isArray(d)?{annotations:d,deletedIds:[]}:d);persist();refresh();
    }catch(x){alert('Invalid JSON file');}};
    rd.readAsText(f);imp.value='';};
  syncGate();
}
function saveNameFromGate(){
  var inp=sb.querySelector('[data-name-input]');
  var name=(inp&&inp.value||'').trim();
  if(!name){if(inp)inp.focus();return;}
  var p=readPrefs();p.displayName=name;writePrefs(p);
  syncGate();renderList();
  if(gateCb){var cb=gateCb;gateCb=null;cb(name);}
}
function ensureName(cb){
  var name=readPrefs().displayName;
  if(name){cb(name);return;}
  gateCb=cb;
  openPanel();
  var inp=sb.querySelector('[data-name-input]');if(inp)inp.focus();
}

function syncFabCount(){
  var el=fab&&fab.querySelector('.bc-anno-fab-n');
  var n, label;
  if(!el) return;
  n=annos.filter(function(a){return a.status!=='done';}).length;
  if(!n){
    el.classList.remove('bc-show');
    el.textContent='';
    if(fab) fab.setAttribute('aria-label','Open notes');
    return;
  }
  label=n>99?'99+':String(n);
  el.textContent=label;
  el.classList.add('bc-show');
  fab.setAttribute('aria-label','Open notes, '+n+' open');
}
function renderList(){
  if(!sb) return;
  syncGate();
  syncFabCount();
  if(!readPrefs().displayName) return;
  var list=sb.querySelector('.bc-anno-list');
  var items=annos.filter(function(a){return currentTab==='open'?a.status!=='done':a.status==='done';});
  items=Model.sortAnnos(items, readPrefs().sort);
  var nOpen=annos.filter(function(a){return a.status!=='done';}).length;
  var nDone=annos.filter(function(a){return a.status==='done';}).length;
  var tabEl=sb.querySelector('[data-tab]');
  if(tabEl&&tabEl.options.length>=2){
    tabEl.options[0].text='Open ('+nOpen+')';
    tabEl.options[1].text='Done ('+nDone+')';
    tabEl.value=currentTab;
  }
  if(!items.length){
    list.innerHTML='<div class="bc-anno-empty">'+(currentTab==='open'?'No notes yet.<br>Select text, Pin a control, or click an image to add one.':'No completed notes.')+'</div>';
    return;
  }
  var html='', keepBottom=readPrefs().sort==='createdAsc';
  var pinNos=Model.imagePinNumbers(annos);
  items.forEach(function(a){
    var q=a.anchorQ==='anchored'?'<span class="bc-anno-badge bc-anno-ok">anchored</span>'
          :a.anchorQ==='fuzzy'?'<span class="bc-anno-badge bc-anno-fz">fuzzy</span>'
          :'<span class="bc-anno-badge bc-anno-or">orphaned</span>';
    var excerpt=a.kind==='image'?('[Image] '+(a.alt||a.srcNorm||a.src||''))
          :a.kind==='el'?('['+((a.elTag||'el').charAt(0).toUpperCase()+(a.elTag||'el').slice(1))+'] '+(a.elName||a.exact||''))
          :(a.exact||'');
    var pinNo=a.pubId||(a.kind==='image'?pinNos[a.id]:null);
    var mine=isMine(a);
    var replies=a.replies||[];
    var rh='';
    if(replies.length){
      rh='<div class="bc-anno-replies">';
      replies.forEach(function(r,ri){
        var rid=r.id||('i'+ri);
        rh+='<div class="bc-anno-reply">'+
          '<div class="bc-anno-rt"><span class="bc-anno-ra">'+esc(r.author||'Anonymous')+'</span>: '+esc(r.text||'')+
          (r.resolved?' <span class="bc-anno-badge bc-anno-ap">resolved</span>':'')+'</div>'+
          (isMine(r)?'<button data-act="resolve-reply" data-rid="'+esc(rid)+'">'+(r.resolved?'Unresolve':'Resolve')+'</button>':'')+
          '</div>';
      });
      rh+='</div>';
    }
    html+='<div class="bc-anno-item" data-id="'+a.id+'">'+
      '<div class="bc-anno-who">'+(pinNo?'<span class="bc-anno-pinno">'+esc(pinNo)+'</span>':'')+esc(a.author||'Anonymous')+'</div>'+
      (a.breadcrumb&&a.breadcrumb.length?'<div class="bc-anno-crumb">'+esc(a.breadcrumb.join(' > '))+'</div>':'')+
      '<div class="bc-anno-ex">'+esc(excerpt)+'</div>'+
      '<div class="bc-anno-cm">'+esc(Model.commentOf(a))+'</div>'+
      rh+
      '<div class="bc-anno-mt"><span>'+fmt(a.updatedAt)+((a.edits&&a.edits.length>1)?' | edited '+a.edits.length+' times':'')+'</span>'+q+'</div>'+
      '<div class="bc-anno-acts">'+
        (mine?'<button data-act="edit">Edit</button>':'')+
        '<button data-act="reply">Reply</button>'+
        (mine?(currentTab==='open'?'<button data-act="done" class="bc-anno-pri">Done</button>':'<button data-act="reopen" class="bc-anno-pri">Reopen</button>'):'')+
        (mine?'<button data-act="del" class="bc-anno-dz">Delete</button>':'')+
      '</div></div>';});
  var prev=list.scrollTop, max=list.scrollHeight;
  list.innerHTML=html;
  if(keepBottom) list.scrollTop=list.scrollHeight;
  else list.scrollTop=prev;
  list.querySelectorAll('.bc-anno-item').forEach(function(el){
    var id=el.getAttribute('data-id');
    el.addEventListener('click',function(ev){
      var b=ev.target.closest('button');
      if(!b){jump(id);return;}
      var act=b.getAttribute('data-act');
      var a=annos.find(function(x){return x.id===id;});if(!a)return;
      if((act==='edit'||act==='done'||act==='reopen'||act==='del')&&!isMine(a)) return;
      if(act==='done'){a.status='done';a.updatedAt=nowISO();persist();refresh();}
      else if(act==='reopen'){a.status='open';a.updatedAt=nowISO();persist();refresh();}
      else if(act==='resolve-reply'){
        var rid=b.getAttribute('data-rid');
        a.replies=a.replies||[];
        a.replies.forEach(function(r,ri){
          if((r.id||('i'+ri))===rid) r.resolved=!r.resolved;
        });
        a.updatedAt=nowISO();persist();refresh();
      }
      else if(act==='del'){
        if(confirm('Delete this note?')){
          deletedIds=Model.mergeDeletedIds(deletedIds,[{id:id,ts:nowISO()}]);
          annos=annos.filter(function(x){return x.id!==id;});
          persist();refresh();
        }
      }
      else if(act==='edit') startEdit(el,a);
      else if(act==='reply') startReply(el,a);
    });});
}
function startEdit(el,a){
  if(!isMine(a)) return;
  var cm=el.querySelector('.bc-anno-cm'),acts=el.querySelector('.bc-anno-acts');
  var ta=document.createElement('textarea');ta.value=Model.commentOf(a);ta.maxLength=Model.MAX_TEXT;
  cm.replaceWith(ta);acts.style.display='none';
  var bar=document.createElement('div');bar.className='bc-anno-acts';
  bar.innerHTML='<button class="bc-anno-pri" data-s>Save</button><button data-c>Cancel</button>';
  el.appendChild(bar);
  bar.querySelector('[data-s]').onclick=function(){
    var v=ta.value.trim();if(!v)return;
    if(!Model.textOk(v))return;
    ensureName(function(name){
      a.edits=a.edits||[];a.edits.push({text:v,ts:nowISO(),author:name});
      a.updatedAt=nowISO();persist();refresh();
    });};
  bar.querySelector('[data-c]').onclick=function(){refresh();};
  ta.focus();
}
function startReply(el,a){
  var acts=el.querySelector('.bc-anno-acts');acts.style.display='none';
  var ta=document.createElement('textarea');ta.placeholder='Reply...';ta.maxLength=Model.MAX_TEXT;
  el.appendChild(ta);
  var bar=document.createElement('div');bar.className='bc-anno-acts';
  bar.innerHTML='<button class="bc-anno-pri" data-s>Send</button><button data-c>Cancel</button>';
  el.appendChild(bar);
  bar.querySelector('[data-s]').onclick=function(){
    var v=ta.value.trim();if(!v)return;
    if(!Model.textOk(v))return;
    ensureName(function(name){
      a.replies=a.replies||[];
      a.replies.push({id:Model.uid(),text:v,ts:nowISO(),author:name,resolved:false,ownerId:ownerKey(),mine:true});
      a.updatedAt=nowISO();persist();refresh();
    });};
  bar.querySelector('[data-c]').onclick=function(){refresh();};
  ta.focus();
}
function jump(id){
  var a=annos.find(function(x){return x.id===id;});
  if(a&&a.kind==='el'){
    if(a._el){
      a._el.scrollIntoView({behavior:'smooth',block:'center'});
      showElHover(a._el);
      setTimeout(function(){if(!pinMode) hideElHover();},1200);
    }
    setTimeout(syncElPins, 280);
    return;
  }
  var sp=document.querySelector('.'+HL+'[data-anno="'+id+'"],.bc-anno-pin[data-anno="'+id+'"],.bc-anno-ibox[data-anno="'+id+'"]');
  if(sp){sp.scrollIntoView({behavior:'smooth',block:'start'});flashEl(sp);return;}
  if(a&&a.kind==='image'&&a._imgEl){a._imgEl.scrollIntoView({behavior:'smooth',block:'start'});flashEl(a._imgEl);return;}
  if(a&&a._range){
    try{var s=locate(a._range.start);if(s){var el=s.node.parentElement;el.scrollIntoView({behavior:'smooth',block:'start'});flashEl(el);}}catch(x){}
  }
}
function flashEl(el){el.classList.add('bc-flash');setTimeout(function(){el.classList.remove('bc-flash');},1300);}

function hidePopovers(){
  if(selButton){selButton.remove();selButton=null;}
  if(editPopover){editPopover.remove();editPopover=null;}
  clearDraft();
  if(!pinMode) hideElHover();
  else showPinHint();
}
function placeNear(rect, h){
  var x=Math.min(window.innerWidth-336,Math.max(8,rect.left));
  var y=rect.bottom+10;
  if(y+(h||190)>window.innerHeight-24) y=Math.max(8,rect.top-(h||190));
  return {x:x,y:y};
}
function onMouseup(ev){
  if(pinMode) return;
  if(skipTextSel){skipTextSel=false;return;}
  if(editPopover&&ev.target.closest&&ev.target.closest('.bc-anno-ed')) return;
  var sel=window.getSelection();
  if(!sel||!sel.rangeCount||sel.isCollapsed){if(selButton&&!editPopover){selButton.remove();selButton=null;}return;}
  if(isUI(sel.anchorNode)){hidePopovers();return;}
  var txt=sel.toString();if(!txt||txt.trim().length<2) return;
  var r;try{r=sel.getRangeAt(0).getBoundingClientRect();}catch(x){return;}
  if(selButton) selButton.remove();
  selButton=document.createElement('button');selButton.type='button';selButton.className='bc-anno-selbtn';
  selButton.setAttribute('data-bc-anno-ui','1');selButton.textContent='+ Note';
  var pos=placeNear(r,46);
  var x=Math.min(window.innerWidth-110,Math.max(8,r.left+r.width/2-55));
  selButton.style.left=x+'px';selButton.style.top=Math.min(window.innerHeight-46,Math.max(8,r.bottom+8))+'px';
  selButton.onclick=function(ev2){ev2.stopPropagation();openEditor(sel,r);};
  document.body.appendChild(selButton);
}
function editorFields(title){
  var needName=!readPrefs().displayName;
  return '<h4>'+title+'</h4>'+
    (needName?'<input type="text" data-ed-name placeholder="Your name" maxlength="80">':'')+
    '<textarea placeholder="Note / update request for AI..." maxlength="4000"></textarea>'+
    '<input class="bc-anno-hp" data-hp tabindex="-1" autocomplete="off">'+
    '<div class="bc-anno-row"><button data-c>Cancel</button><button class="bc-anno-pri" data-s>Save</button></div>';
}
function bindEditor(a, openedAt, onSave){
  var ta=editPopover.querySelector('textarea');ta.focus();
  editPopover.querySelector('[data-c]').onclick=hidePopovers;
  editPopover.querySelector('[data-s]').onclick=function(){
    var hp=editPopover.querySelector('[data-hp]');
    if(!Model.allowSubmit(openedAt, Date.now(), hp&&hp.value)) return;
    var v=ta.value.trim();if(!v){ta.focus();return;}
    if(!Model.textOk(v)){ta.focus();return;}
    var nameInp=editPopover.querySelector('[data-ed-name]');
    if(nameInp){
      var nm=nameInp.value.trim();if(!nm){nameInp.focus();return;}
      var p=readPrefs();p.displayName=nm;writePrefs(p);
    }
    onSave(v);
  };
  editPopover.addEventListener('keydown',function(e){
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();hidePopovers();}
    if(e.key==='Enter'&&(e.metaKey||e.ctrlKey)) editPopover.querySelector('[data-s]').click();
  });
}
function commitNew(a, text){
  ensureName(function(name){
    a.author=name;
    a.edits=[{text:text,ts:nowISO(),author:name}];
    a.replies=a.replies||[];
    a.resolved=!!a.resolved;
    a.approved=a.resolved;
    annos.push(a);
    persist();
    setPinMode(false);
    refresh();
    toast('Saved');
  });
}
function openEditor(sel, rect){
  if(selButton){selButton.remove();selButton=null;}
  var a=captureFromSelection(sel);
  if(!a){alert('Could not create a note at this location.');return;}
  var range=null;
  try{range=sel.getRangeAt(0).cloneRange();}catch(x){}
  editPopover=document.createElement('div');editPopover.className='bc-anno-ed';
  editPopover.setAttribute('data-bc-anno-ui','1');
  editPopover.innerHTML=editorFields('New note');
  var pos=placeNear(rect,220);
  editPopover.style.left=pos.x+'px';editPopover.style.top=pos.y+'px';
  document.body.appendChild(editPopover);
  setDraft({kind:'text', range:range});
  bindEditor(a, Date.now(), function(v){
    try{sel.removeAllRanges();}catch(x){}
    commitNew(a,v);
  });
}
function openElEditor(el, ev){
  hidePopovers();
  var a=captureFromEl(el, clientX(ev), clientY(ev));
  editPopover=document.createElement('div');editPopover.className='bc-anno-ed';
  editPopover.setAttribute('data-bc-anno-ui','1');
  editPopover.innerHTML=editorFields('Pin note');
  var pos=placeNear(el.getBoundingClientRect(),220);
  editPopover.style.left=pos.x+'px';editPopover.style.top=pos.y+'px';
  document.body.appendChild(editPopover);
  setDraft({kind:'el', el:el, xPct:a.xPct, yPct:a.yPct});
  bindEditor(a, Date.now(), function(v){commitNew(a,v);});
}
function openImageEditor(img, xPct, yPct, wPct, hPct, rect){
  var a=captureFromImage(img,xPct,yPct,wPct,hPct);
  editPopover=document.createElement('div');editPopover.className='bc-anno-ed';
  editPopover.setAttribute('data-bc-anno-ui','1');
  editPopover.innerHTML=editorFields('Image note');
  var pos=placeNear(rect||img.getBoundingClientRect(),220);
  editPopover.style.left=pos.x+'px';editPopover.style.top=pos.y+'px';
  document.body.appendChild(editPopover);
  setDraft({kind:'image', img:img, xPct:xPct, yPct:yPct, wPct:wPct, hPct:hPct});
  bindEditor(a, Date.now(), function(v){commitNew(a,v);});
}

function clientX(ev){return ev.clientX;}
function clientY(ev){return ev.clientY;}
function imgBoxFromPts(img, x0, y0, x1, y1){
  var r=img.getBoundingClientRect();
  var xa=Math.max(r.left, Math.min(x0,x1));
  var ya=Math.max(r.top, Math.min(y0,y1));
  var xb=Math.min(r.right, Math.max(x0,x1));
  var yb=Math.min(r.bottom, Math.max(y0,y1));
  var w=r.width||1,h=r.height||1;
  return {
    xPct:(xa-r.left)/w, yPct:(ya-r.top)/h,
    wPct:(xb-xa)/w, hPct:(yb-ya)/h,
    rect:{left:xa,top:ya,bottom:yb,width:xb-xa,height:yb-ya}
  };
}
function applyImagePlacement(a, next){
  a.xPct=next.xPct; a.yPct=next.yPct; a.wPct=next.wPct; a.hPct=next.hPct;
}
function syncImageMark(a){
  var img=a&&a._imgEl, wrap, pin, box, isBox;
  if(!img||!img.parentNode) return;
  wrap=img.parentNode;
  pin=wrap.querySelector('.bc-anno-pin[data-anno="'+a.id+'"]');
  box=wrap.querySelector('.bc-anno-ibox[data-anno="'+a.id+'"]');
  isBox=Model.isImageBox(a);
  if(box){
    box.style.left=(a.xPct*100)+'%';
    box.style.top=(a.yPct*100)+'%';
    box.style.width=(a.wPct*100)+'%';
    box.style.height=(a.hPct*100)+'%';
  }
  if(pin){
    pin.style.left=((isBox?(a.xPct+a.wPct/2):a.xPct)*100)+'%';
    pin.style.top=((isBox?(a.yPct+a.hPct/2):a.yPct)*100)+'%';
  }
}
function placementFromPinDrag(ev){
  var a=pinDrag.a, img=a._imgEl, p;
  if(!img) return null;
  p=Model.pctFromClient(img.getBoundingClientRect(), clientX(ev), clientY(ev));
  if(pinDrag.from==='box') return Model.placeImageBox(a, p.xPct-pinDrag.grabX, p.yPct-pinDrag.grabY);
  return Model.placeImagePin(a, p.xPct, p.yPct);
}
function setMarkDragging(a, on){
  var img=a&&a._imgEl, wrap, nodes, i;
  if(!img||!img.parentNode) return;
  wrap=img.parentNode;
  nodes=wrap.querySelectorAll('.bc-anno-pin[data-anno="'+a.id+'"],.bc-anno-ibox[data-anno="'+a.id+'"]');
  for(i=0;i<nodes.length;i++){
    if(on) nodes[i].classList.add('bc-drag');
    else nodes[i].classList.remove('bc-drag');
  }
}

document.addEventListener('mousedown',function(ev){
  if(ev.button!==0) return;
  var mark=ev.target.closest&&ev.target.closest('.bc-anno-pin, .bc-anno-ibox');
  if(mark){
    var id=mark.getAttribute('data-anno');
    var a=annos.find(function(x){return x.id===id;});
    if(!a||a.kind!=='image'||!a._imgEl) return;
    if(!isMine(a)) return;
    ev.preventDefault();
    hidePopovers();
    var p=Model.pctFromClient(a._imgEl.getBoundingClientRect(), clientX(ev), clientY(ev));
    pinDrag={a:a, from:mark.classList.contains('bc-anno-ibox')?'box':'pin',
      x0:clientX(ev), y0:clientY(ev), grabX:p.xPct-(a.xPct||0), grabY:p.yPct-(a.yPct||0)};
    pinMoved=false;
    skipTextSel=true;
    return;
  }
  if(isUI(ev.target)) return;
  var img=ev.target.closest&&ev.target.closest('img');
  if(!img||isUI(img)) return;
  if(pinMode&&pickPinHost(ev.target)) return;
  imgDrag={img:img,x0:clientX(ev),y0:clientY(ev),moved:false};
},true);
document.addEventListener('mousemove',function(ev){
  var dx, dy, next;
  if(pinDrag){
    dx=clientX(ev)-pinDrag.x0; dy=clientY(ev)-pinDrag.y0;
    if(!pinMoved&&(dx*dx+dy*dy)<64) return;
    if(!pinMoved){pinMoved=true;setMarkDragging(pinDrag.a,true);}
    ev.preventDefault();
    next=placementFromPinDrag(ev);
    if(!next) return;
    applyImagePlacement(pinDrag.a, next);
    syncImageMark(pinDrag.a);
    return;
  }
  if(pinMode&&!imgDrag&&!editPopover){
    if(isUI(ev.target)) hideElHover();
    else{
      var hoverHost=pickPinHost(ev.target);
      if(hoverHost) showElHover(hoverHost); else hideElHover();
    }
  }
  if(!imgDrag) return;
  dx=clientX(ev)-imgDrag.x0; dy=clientY(ev)-imgDrag.y0;
  if(!imgDrag.moved&&(dx*dx+dy*dy)<64) return;
  imgDrag.moved=true;
  ev.preventDefault();
  if(!dragBox){
    dragBox=document.createElement('div');dragBox.className='bc-anno-dragbox';
    dragBox.setAttribute('data-bc-anno-ui','1');document.body.appendChild(dragBox);
  }
  var box=imgBoxFromPts(imgDrag.img,imgDrag.x0,imgDrag.y0,clientX(ev),clientY(ev));
  dragBox.style.left=box.rect.left+'px';dragBox.style.top=box.rect.top+'px';
  dragBox.style.width=box.rect.width+'px';dragBox.style.height=box.rect.height+'px';
},true);
document.addEventListener('mouseup',function(ev){
  if(pinDrag){
    var a=pinDrag.a, moved=pinMoved;
    setMarkDragging(a,false);
    pinDrag=null;
    if(moved){
      ev.preventDefault();
      a.updatedAt=nowISO();
      persist();
      refresh();
    }
    return;
  }
  if(!imgDrag) return;
  var img=imgDrag.img, moved=imgDrag.moved, x0=imgDrag.x0, y0=imgDrag.y0;
  imgDrag=null;skipTextSel=true;
  if(dragBox){dragBox.remove();dragBox=null;}
  var box;
  if(moved) box=imgBoxFromPts(img,x0,y0,clientX(ev),clientY(ev));
  else{
    var r=img.getBoundingClientRect();
    box={xPct:(clientX(ev)-r.left)/(r.width||1), yPct:(clientY(ev)-r.top)/(r.height||1), wPct:0, hPct:0, rect:{left:clientX(ev),top:clientY(ev),bottom:clientY(ev)+1,width:1,height:1}};
  }
  hidePopovers();
  setTimeout(function(){
    openImageEditor(img, box.xPct, box.yPct, box.wPct, box.hPct, box.rect);
  },0);
},true);

document.addEventListener('mouseup',function(ev){
  if(editPopover) return;
  setTimeout(function(){onMouseup(ev);},0);
});
document.addEventListener('click',function(ev){
  if(!selButton&&!editPopover) return;
  var t=ev.target;
  if(selButton&&t!==selButton&&!selButton.contains(t)){selButton.remove();selButton=null;}
  if(editPopover&&!editPopover.contains(t)&&!(selButton&&selButton.contains(t))){
    hidePopovers();
  }
});
document.addEventListener('click',function(ev){
  if(!pinMode||editPopover) return;
  if(isUI(ev.target)) return;
  var img=ev.target.closest&&ev.target.closest('img');
  var host=pickPinHost(ev.target);
  if(img&&!host) return;
  ev.preventDefault();
  ev.stopPropagation();
  if(!host){toast('Nothing to pin here');return;}
  openElEditor(host, ev);
},true);
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(editPopover||selButton){hidePopovers();return;}
    if(pinMode){setPinMode(false);return;}
    var ae=document.activeElement;
    if(panelOpen()&&ae&&sb.contains(ae)&&(ae.tagName==='TEXTAREA'||ae.tagName==='INPUT')){refresh();return;}
    if(panelOpen()) closePanel();
    return;
  }
  if((e.key==='n'||e.key==='N')&&e.altKey&&!e.metaKey&&!e.ctrlKey){
    e.preventDefault();
    togglePanel();
  }
});

function docJSON(){
  return {v:3,page:{url:location.href,title:document.title},deletedIds:deletedIds,annotations:annos};
}
function ingestDoc(d){
  var merged=Model.mergeDocs({annotations:annos,deletedIds:deletedIds}, d||{});
  merged.annotations.forEach(function(a){Model.normalizeAnno(a);});
  Model.ensurePubIds(merged.annotations);
  annos=merged.annotations;deletedIds=merged.deletedIds;
}
var RATE_KEY='bcAnno:rate';
function clientRateHit(){
  var now=Math.floor(Date.now()/1000), times=[];
  try{times=JSON.parse(localStorage.getItem(RATE_KEY)||'[]');}catch(x){}
  var r=Model.rateRecord(times, now, 10, 60);
  if(!r.ok) return false;
  try{localStorage.setItem(RATE_KEY, JS(r.times));}catch(x){}
  return true;
}
function persist(){
  try{localStorage.setItem(STORE_KEY,JS(docJSON()));}catch(x){}
  if(API) remoteSave();
}
var remoteSave=debounce(function(){
  if(!clientRateHit()){toast('Rate limit: wait a minute');return;}
  try{fetch(apiUrl(),{
    method:'PUT',headers:apiHeaders(true),body:JS(docJSON())})
    .then(function(res){if(res&&res.status===429) toast('Rate limit: wait a minute');})
    .catch(function(){});}catch(x){}
},900);
function loadLocal(){
  try{var s=localStorage.getItem(STORE_KEY);if(!s)return;
    ingestDoc(JSON.parse(s));}catch(x){}
}
function loadAll(){
  loadLocal();
  if(!API){refresh();return;}
  var ctl=('AbortController'in window)?new AbortController():null;
  if(ctl) setTimeout(function(){ctl.abort();},2500);
  try{fetch(apiUrl(),ctl?{signal:ctl.signal,headers:apiHeaders()}:{headers:apiHeaders()})
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){if(d) ingestDoc(d);})
    .catch(function(){})
    .then(function(){refresh();});}catch(x){refresh();}
}
function downloadBlob(name, text, mime){
  var blob=new Blob([text],{type:mime});
  var aEl=document.createElement('a');aEl.href=URL.createObjectURL(blob);aEl.download=name;
  document.body.appendChild(aEl);aEl.click();
  setTimeout(function(){URL.revokeObjectURL(aEl.href);aEl.remove();},500);
}
function fileStub(){
  return (location.hostname||'local')+'-'+location.pathname.replace(/[^a-z0-9]+/gi,'-').replace(/^-+|-+$/g,'').slice(0,40);
}
function exportJSON(){
  var data=Model.exportPayload({url:location.href,title:document.title}, annos, {exportedAt:nowISO(),apiBase:API||''});
  downloadBlob('notes-'+fileStub()+'.json', JS(data,null,2), 'application/json');
}

function init(){
  injectStyle();buildUI();
  index=buildIndex();lastText=index.text;
  loadAll();
  document.addEventListener('click',function(ev){
    if(pinMoved){
      pinMoved=false;
      ev.preventDefault();
      ev.stopPropagation();
      return;
    }
    var hl=ev.target.closest&&ev.target.closest('.'+HL+', .bc-anno-pin, .bc-anno-ibox');
    if(!hl) return;
    var id=hl.getAttribute('data-anno');
    openPanel();
    jump(id);
    var item=sb.querySelector('.bc-anno-item[data-id="'+id+'"]');
    if(item) item.scrollIntoView({block:'nearest'});
  },true);
  var mo=new MutationObserver(debounce(function(muts){
    var i, m;
    if(!index) return;
    muts=muts||[];
    for(i=0;i<muts.length;i++){
      m=muts[i];
      if(isAnnoDom(m.target)) continue;
      if(buildIndex().text!==lastText) refresh();
      return;
    }
  },600));
  mo.observe(document.body,{childList:true,subtree:true,characterData:true});
  document.addEventListener('scroll',syncElPins,true);
  window.addEventListener('resize',syncElPins);
  window.addEventListener('resize',debounce(function(){if(index&&buildIndex().text!==lastText)refresh();},400));
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})(typeof window!=='undefined'?window:this);
