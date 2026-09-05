/* bc-annotator v3 | embed: <script src="index.php"></script>
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
  if(series===0) return pad;
  return String.fromCharCode(64+series)+pad;
};
Model.nextPubId = function(list){
  var used={}, i, a, n=0, idx, max=-1, m, series, num;
  for(i=0;i<(list||[]).length;i++){
    a=list[i]; if(!a||!a.pubId) continue;
    used[a.pubId]=true;
    m=String(a.pubId).match(/^([A-Z])?(\d{2})$/);
    if(!m) continue;
    num=parseInt(m[2],10);
    if(num<1||num>99) continue;
    series=m[1]?(m[1].charCodeAt(0)-64):0;
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
var sb,fab,gateCb=null;
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
  var marks=document.querySelectorAll('.bc-anno-pin,.bc-anno-ibox'),i,m;
  for(i=0;i<marks.length;i++){m=marks[i];if(m.parentNode)m.parentNode.removeChild(m);}
  var wraps=document.querySelectorAll('.bc-anno-imgwrap'),w,img;
  for(i=0;i<wraps.length;i++){
    w=wraps[i];img=w.querySelector('img');
    if(img&&w.parentNode){w.parentNode.insertBefore(img,w);w.parentNode.removeChild(w);}
  }
}
function ensureImgWrap(img){
  if(img.parentNode&&img.parentNode.classList&&img.parentNode.classList.contains('bc-anno-imgwrap')) return img.parentNode;
  var w=document.createElement('span');w.className='bc-anno-imgwrap';
  img.parentNode.insertBefore(w,img);w.appendChild(img);return w;
}
function renderHl(){
  clearHl();clearImgMarks();
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
}

function injectStyle(){
  var st=document.createElement('style');st.setAttribute('data-bc-anno-ui','1');
  st.textContent=
  '.bc-anno-hl{background:#FFE7E3;border-bottom:2px solid #FF6B5C;border-radius:2px;cursor:pointer;}'+
  '.bc-anno-hl.bc-flash{animation:bcAnnoFlash 1.2s ease;}'+
  '@keyframes bcAnnoFlash{0%,100%{background:#FFE7E3}30%{background:#FF6B5C}}'+
  '.bc-anno-imgwrap{position:relative;display:inline-block;max-width:100%;overflow:visible;}'+
  '.bc-anno-imgwrap img{display:block;max-width:100%;height:auto;}'+
  '.bc-anno-pin{position:absolute;min-width:22px;height:22px;padding:0 4px;margin:-11px 0 0 -11px;display:flex;align-items:center;justify-content:center;background:#FF6B5C;border:3px solid #fff;border-radius:999px;box-shadow:0 2px 8px rgba(16,40,45,.45);cursor:grab;z-index:6;pointer-events:auto;color:#fff;font:800 10px/1 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;user-select:none;box-sizing:border-box;animation:bcPinPulse 1.4s ease-out 3;}'+
  '@keyframes bcPinPulse{0%{box-shadow:0 2px 8px rgba(16,40,45,.45),0 0 0 0 rgba(255,107,92,.55)}100%{box-shadow:0 2px 8px rgba(16,40,45,.45),0 0 0 14px rgba(255,107,92,0)}}'+
  '.bc-anno-ibox{position:absolute;border:2px solid #FF6B5C;background:rgba(255,107,92,.18);cursor:grab;z-index:5;box-sizing:border-box;}'+
  '.bc-anno-pin.bc-drag,.bc-anno-ibox.bc-drag{cursor:grabbing;animation:none;z-index:8;}'+
  '.bc-anno-dragbox{position:fixed;border:2px dashed #FF6B5C;background:rgba(255,107,92,.12);z-index:2147483003;pointer-events:none;}'+
  '.bc-anno-sb{position:fixed;right:16px;bottom:16px;width:400px;max-width:calc(100vw - 24px);height:66.67vh;max-height:66.67vh;background:#fff;border:1px solid #DEE1EA;border-radius:12px;box-shadow:0 10px 36px rgba(16,40,45,.22);z-index:2147483000;display:flex;flex-direction:column;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;color:#15192B;overflow:hidden;}'+
  '.bc-anno-sb.bc-hide{opacity:0;pointer-events:none;visibility:hidden;transform:translate(12px,16px);}'+
  '.bc-anno-sb-h{padding:8px 8px 8px 10px;background:linear-gradient(135deg,#0B1566,#1428A0);color:#fff;flex:none;display:flex;align-items:center;gap:6px;}'+
  '.bc-anno-sb-h select,.bc-anno-sb-h button:not(.x){font-size:11px;padding:4px 7px;border-radius:6px;border:1px solid rgba(255,255,255,.4);background:#0B1566;color:#fff;cursor:pointer;font-weight:600;}'+
  '.bc-anno-sb-h button:not(.x){background:transparent;}'+
  '.bc-anno-sb-h button:not(.x):hover{background:rgba(255,255,255,.15);}'+
  '.bc-anno-sb-h .x{margin-left:auto;cursor:pointer;background:none;border:none;color:#fff;font-size:16px;padding:2px 6px;line-height:1;}'+
  '.bc-anno-list{flex:1;overflow-y:auto;padding:10px 12px;min-height:0;}'+
  '.bc-anno-item{border:1px solid #DEE1EA;border-radius:10px;padding:10px 12px;margin-bottom:10px;background:#fff;cursor:pointer;}'+
  '.bc-anno-item:hover{border-color:#4E66D6;box-shadow:0 1px 4px rgba(16,40,45,.08);}'+
  '.bc-anno-item .who{font-size:11px;font-weight:700;color:#1428A0;margin-bottom:2px;display:flex;align-items:center;gap:6px;}'+
  '.bc-anno-pinno{display:inline-flex;align-items:center;justify-content:center;min-width:18px;height:18px;padding:0 5px;background:#FF6B5C;color:#fff;border-radius:999px;font-size:11px;font-weight:800;}'+
  '.bc-anno-item .bc{font-size:11px;color:#5B6173;margin-bottom:4px;word-break:break-word;}'+
  '.bc-anno-item .ex{font-size:12px;color:#2E3447;font-style:italic;border-left:3px solid #AEBCEC;padding-left:8px;margin:4px 0 6px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}'+
  '.bc-anno-item .cm{font-size:13px;white-space:pre-wrap;word-break:break-word;}'+
  '.bc-anno-item .mt{font-size:11px;color:#8B90A0;margin-top:6px;display:flex;justify-content:space-between;align-items:center;gap:6px;flex-wrap:wrap;}'+
  '.bc-anno-badge{font-size:10.5px;font-weight:700;border-radius:999px;padding:1px 8px;}'+
  '.bc-anno-badge.ok{background:#E5F4EC;color:#136B45;}'+
  '.bc-anno-badge.fz{background:#FBF1DD;color:#8A5A0E;}'+
  '.bc-anno-badge.or{background:#FBEAE8;color:#97271C;}'+
  '.bc-anno-badge.ap{background:#EEF1FF;color:#1428A0;}'+
  '.bc-anno-acts{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap;}'+
  '.bc-anno-acts button{font-size:11.5px;padding:3px 10px;border-radius:6px;border:1px solid #DEE1EA;background:#fff;color:#2E3447;cursor:pointer;font-weight:600;}'+
  '.bc-anno-acts button:hover{border-color:#1428A0;color:#1428A0;}'+
  '.bc-anno-acts button.pri{background:#1428A0;border-color:#1428A0;color:#fff;}'+
  '.bc-anno-acts button.dz:hover{border-color:#C0392B;color:#C0392B;}'+
  '.bc-anno-item textarea{width:100%;min-height:58px;border:1px solid #4E66D6;border-radius:8px;padding:8px;font:13px/1.5 inherit;box-sizing:border-box;}'+
  '.bc-anno-replies{max-height:120px;overflow-y:auto;margin-top:8px;padding:6px 8px;background:#F6F7FB;border-radius:8px;}'+
  '.bc-anno-reply{font-size:12px;margin:0 0 6px;word-break:break-word;display:flex;align-items:flex-start;justify-content:space-between;gap:8px;}'+
  '.bc-anno-reply .rt{min-width:0;flex:1;}'+
  '.bc-anno-reply button{flex:none;font-size:10.5px;padding:2px 8px;border-radius:6px;border:1px solid #DEE1EA;background:#fff;color:#2E3447;cursor:pointer;font-weight:600;}'+
  '.bc-anno-reply .ra{font-weight:700;color:#1428A0;}'+
  '.bc-anno-empty{text-align:center;color:#8B90A0;font-size:12.5px;padding:30px 10px;}'+
  '.bc-anno-ft{flex:none;padding:8px 14px;border-top:1px solid #EDEFF5;font-size:11px;color:#8B90A0;}'+
  '.bc-anno-gate{padding:16px 14px;}'+
  '.bc-anno-gate p{margin:0 0 10px;font-size:13px;}'+
  '.bc-anno-gate input{width:100%;box-sizing:border-box;border:1px solid #DEE1EA;border-radius:8px;padding:8px;font:13px/1.5 inherit;}'+
  '.bc-anno-gate button{margin-top:10px;background:#1428A0;color:#fff;border:none;border-radius:8px;padding:8px 14px;font-weight:700;cursor:pointer;}'+
  '.bc-anno-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;display:flex;align-items:center;gap:8px;background:#1428A0;color:#fff;border:none;border-radius:999px;padding:10px 16px 10px 12px;font-size:12px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(16,40,45,.25);animation:bcFabPop .55s cubic-bezier(.22,1.4,.36,1) both,bcFabPulse 2.2s ease-in-out .55s infinite;}'+
  '.bc-anno-fab-ic{display:flex;animation:bcFabWiggle 2.2s ease-in-out .55s infinite;}'+
  '@keyframes bcFabPop{0%{transform:translateY(18px) scale(.85)}70%{transform:translateY(-4px) scale(1.08)}100%{transform:none}}'+
  '@keyframes bcFabPulse{0%,100%{box-shadow:0 4px 14px rgba(16,40,45,.25),0 0 0 0 rgba(255,107,92,.4)}50%{box-shadow:0 8px 22px rgba(20,40,160,.35),0 0 0 8px rgba(255,107,92,0)}}'+
  '@keyframes bcFabWiggle{0%,72%,100%{transform:rotate(0)}80%{transform:rotate(-14deg)}88%{transform:rotate(10deg)}94%{transform:rotate(-6deg)}}'+
  '@media (prefers-reduced-motion:reduce){.bc-anno-fab,.bc-anno-fab-ic{animation:none;}}'+
  '.bc-anno-selbtn{position:fixed;z-index:2147483001;background:#FF6B5C;color:#15192B;border:none;border-radius:999px;padding:6px 14px;font-size:12.5px;font-weight:700;cursor:pointer;box-shadow:0 4px 14px rgba(16,40,45,.25);}'+
  '.bc-anno-ed{position:fixed;z-index:2147483002;background:#fff;border:1px solid #DEE1EA;border-radius:12px;box-shadow:0 10px 36px rgba(16,40,45,.22);padding:12px;width:320px;max-width:92vw;}'+
  '.bc-anno-ed h4{margin:0 0 8px;font-size:12.5px;color:#1428A0;}'+
  '.bc-anno-ed textarea,.bc-anno-ed input[type=text]{width:100%;min-height:74px;border:1px solid #DEE1EA;border-radius:8px;padding:8px;font:13px/1.5 inherit;box-sizing:border-box;margin-bottom:8px;}'+
  '.bc-anno-ed input[type=text]{min-height:0;}'+
  '.bc-anno-ed textarea:focus,.bc-anno-ed input:focus{outline:none;border-color:#1428A0;}'+
  '.bc-anno-ed .r{display:flex;gap:8px;justify-content:flex-end;margin-top:8px;}'+
  '.bc-anno-ed button{font-size:12.5px;padding:5px 14px;border-radius:7px;border:1px solid #DEE1EA;background:#fff;cursor:pointer;font-weight:600;}'+
  '.bc-anno-ed button.pri{background:#1428A0;border-color:#1428A0;color:#fff;}'+
  '.bc-anno-hp{position:absolute;left:-10000px;width:1px;height:1px;opacity:0;}'+
  '.bc-anno-toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#1428A0;color:#fff;padding:8px 14px;border-radius:999px;z-index:2147483004;font:12.5px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;}'+
  '@media (max-width:767px){.bc-anno-sb{left:0;right:0;top:0;bottom:0;width:100%;max-width:none;height:auto;max-height:none;border-radius:0;}.bc-anno-sb.bc-hide{transform:translateY(12px);}.bc-anno-fab{bottom:12px;right:12px;}}';
  document.head.appendChild(st);
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
  sb.classList.remove('bc-hide');fab.style.display='none';
  syncGate();renderList();
}
function closePanel(){
  sb.classList.add('bc-hide');fab.style.display='';
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
    '<button type="button" class="x" data-x>&#10005;</button>'+
  '</div>'+
  '<div class="bc-anno-gate">'+
    '<p>Enter your name before viewing the note list.</p>'+
    '<input type="text" data-name-input placeholder="Display name" maxlength="80">'+
    '<button type="button" data-name-save>Save name</button>'+
  '</div>'+
  '<div class="bc-anno-list"></div>'+
  '<div class="bc-anno-ft">Select text or click / drag an image | Alt+N toggle | Esc close</div>';
  document.body.appendChild(sb);

  fab=document.createElement('button');fab.className='bc-anno-fab';fab.setAttribute('data-bc-anno-ui','1');
  fab.setAttribute('aria-label','Open notes');
  fab.innerHTML='<span class="bc-anno-fab-ic" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 3h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm8 1.5V9h4.5zM8 12h8v1.5H8zm0 3.5h8V17H8z"/></svg></span><span>Notes</span>';
  fab.onclick=function(){openPanel();};
  document.body.appendChild(fab);

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

function renderList(){
  if(!sb) return;
  syncGate();
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
    list.innerHTML='<div class="bc-anno-empty">'+(currentTab==='open'?'No notes yet.<br>Select text or click an image to add one.':'No completed notes.')+'</div>';
    return;
  }
  var html='', keepBottom=readPrefs().sort==='createdAsc';
  var pinNos=Model.imagePinNumbers(annos);
  items.forEach(function(a){
    var q=a.anchorQ==='anchored'?'<span class="bc-anno-badge ok">anchored</span>'
          :a.anchorQ==='fuzzy'?'<span class="bc-anno-badge fz">fuzzy</span>'
          :'<span class="bc-anno-badge or">orphaned</span>';
    var excerpt=a.kind==='image'?('[Image] '+(a.alt||a.srcNorm||a.src||'')):(a.exact||'');
    var pinNo=a.pubId||(a.kind==='image'?pinNos[a.id]:null);
    var mine=isMine(a);
    var replies=a.replies||[];
    var rh='';
    if(replies.length){
      rh='<div class="bc-anno-replies">';
      replies.forEach(function(r,ri){
        var rid=r.id||('i'+ri);
        rh+='<div class="bc-anno-reply">'+
          '<div class="rt"><span class="ra">'+esc(r.author||'Anonymous')+'</span>: '+esc(r.text||'')+
          (r.resolved?' <span class="bc-anno-badge ap">resolved</span>':'')+'</div>'+
          (isMine(r)?'<button data-act="resolve-reply" data-rid="'+esc(rid)+'">'+(r.resolved?'Unresolve':'Resolve')+'</button>':'')+
          '</div>';
      });
      rh+='</div>';
    }
    html+='<div class="bc-anno-item" data-id="'+a.id+'">'+
      '<div class="who">'+(pinNo?'<span class="bc-anno-pinno">'+esc(pinNo)+'</span>':'')+esc(a.author||'Anonymous')+'</div>'+
      (a.breadcrumb&&a.breadcrumb.length?'<div class="bc">'+esc(a.breadcrumb.join(' > '))+'</div>':'')+
      '<div class="ex">'+esc(excerpt)+'</div>'+
      '<div class="cm">'+esc(Model.commentOf(a))+'</div>'+
      rh+
      '<div class="mt"><span>'+fmt(a.updatedAt)+((a.edits&&a.edits.length>1)?' | edited '+a.edits.length+' times':'')+'</span>'+q+'</div>'+
      '<div class="bc-anno-acts">'+
        (mine?'<button data-act="edit">Edit</button>':'')+
        '<button data-act="reply">Reply</button>'+
        (mine?(currentTab==='open'?'<button data-act="done" class="pri">Done</button>':'<button data-act="reopen" class="pri">Reopen</button>'):'')+
        (mine?'<button data-act="del" class="dz">Delete</button>':'')+
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
  var cm=el.querySelector('.cm'),acts=el.querySelector('.bc-anno-acts');
  var ta=document.createElement('textarea');ta.value=Model.commentOf(a);ta.maxLength=Model.MAX_TEXT;
  cm.replaceWith(ta);acts.style.display='none';
  var bar=document.createElement('div');bar.className='bc-anno-acts';
  bar.innerHTML='<button class="pri" data-s>Save</button><button data-c>Cancel</button>';
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
  bar.innerHTML='<button class="pri" data-s>Send</button><button data-c>Cancel</button>';
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
  var sp=document.querySelector('.'+HL+'[data-anno="'+id+'"],.bc-anno-pin[data-anno="'+id+'"],.bc-anno-ibox[data-anno="'+id+'"]');
  if(sp){sp.scrollIntoView({behavior:'smooth',block:'start'});flashEl(sp);return;}
  var a=annos.find(function(x){return x.id===id;});
  if(a&&a.kind==='image'&&a._imgEl){a._imgEl.scrollIntoView({behavior:'smooth',block:'start'});flashEl(a._imgEl);return;}
  if(a&&a._range){
    try{var s=locate(a._range.start);if(s){var el=s.node.parentElement;el.scrollIntoView({behavior:'smooth',block:'start'});flashEl(el);}}catch(x){}
  }
}
function flashEl(el){el.classList.add('bc-flash');setTimeout(function(){el.classList.remove('bc-flash');},1300);}

function hidePopovers(){
  if(selButton){selButton.remove();selButton=null;}
  if(editPopover){editPopover.remove();editPopover=null;}
}
function placeNear(rect, h){
  var x=Math.min(window.innerWidth-336,Math.max(8,rect.left));
  var y=rect.bottom+10;
  if(y+(h||190)>window.innerHeight-24) y=Math.max(8,rect.top-(h||190));
  return {x:x,y:y};
}
function onMouseup(ev){
  if(skipTextSel){skipTextSel=false;return;}
  if(editPopover&&ev.target.closest&&ev.target.closest('.bc-anno-ed')) return;
  var sel=window.getSelection();
  if(!sel||!sel.rangeCount||sel.isCollapsed){if(selButton&&!editPopover){selButton.remove();selButton=null;}return;}
  if(isUI(sel.anchorNode)){hidePopovers();return;}
  var txt=sel.toString();if(!txt||txt.trim().length<2) return;
  var r;try{r=sel.getRangeAt(0).getBoundingClientRect();}catch(x){return;}
  if(selButton) selButton.remove();
  selButton=document.createElement('button');selButton.className='bc-anno-selbtn';
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
    '<div class="r"><button data-c>Cancel</button><button class="pri" data-s>Save</button></div>';
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
    if(e.key==='Escape'){e.preventDefault();hidePopovers();}
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
    persist();hidePopovers();refresh();
    toast('Saved');
  });
}
function openEditor(sel, rect){
  if(selButton){selButton.remove();selButton=null;}
  var a=captureFromSelection(sel);
  if(!a){alert('Could not create a note at this location.');return;}
  editPopover=document.createElement('div');editPopover.className='bc-anno-ed';
  editPopover.setAttribute('data-bc-anno-ui','1');
  editPopover.innerHTML=editorFields('New note');
  var pos=placeNear(rect,220);
  editPopover.style.left=pos.x+'px';editPopover.style.top=pos.y+'px';
  document.body.appendChild(editPopover);
  bindEditor(a, Date.now(), function(v){
    try{sel.removeAllRanges();}catch(x){}
    commitNew(a,v);
  });
}
function openImageEditor(img, xPct, yPct, wPct, hPct, rect){
  var a=captureFromImage(img,xPct,yPct,wPct,hPct);
  editPopover=document.createElement('div');editPopover.className='bc-anno-ed';
  editPopover.setAttribute('data-bc-anno-ui','1');
  editPopover.innerHTML=editorFields('Image note');
  var pos=placeNear(rect||img.getBoundingClientRect(),220);
  editPopover.style.left=pos.x+'px';editPopover.style.top=pos.y+'px';
  document.body.appendChild(editPopover);
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
  if(editPopover&&!editPopover.contains(t)&&!(selButton&&selButton.contains(t))){editPopover.remove();editPopover=null;}
});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){
    if(editPopover||selButton){hidePopovers();return;}
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
  var mo=new MutationObserver(debounce(function(){
    if(!index) return;
    var t=buildIndex().text;
    if(t!==lastText) refresh();
  },600));
  mo.observe(document.body,{childList:true,subtree:true,characterData:true});
  window.addEventListener('resize',debounce(function(){if(index&&buildIndex().text!==lastText)refresh();},400));
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init);
else init();
})(typeof window!=='undefined'?window:this);
