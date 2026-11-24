import {addDays, dayIndex, peakDays, aggregate, areaStats} from "./indicators.mjs";

const $ = id => document.getElementById(id);
$("map-date-slot").append($("date-template").content.cloneNode(true));
const svg = (name, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const metrics = {
  frost: {name:"Giorni con gelo", title:"Giorni con gelo",
    copy:"Conta i giorni in cui la temperatura minima stimata è scesa a 0 °C o meno.",
    tip:"La temperatura al suolo può essere diversa da quella dell’aria.",
    unit:"gg", range:[0,30], stops:["#ecf3f9","#bfd9ed","#72acd4","#426cae","#2f386f"]},
  rain: {name:"Pioggia totale", title:"Pioggia totale",
    copy:"Pioggia totale stimata nel periodo.",
    tip:"Senza un riferimento storico non sappiamo se il totale è anomalo. Non è una misura della siccità.",
    unit:"mm", range:[0,180], stops:["#f4f8fc","#c0def0","#75b6df","#3f83bf","#225285"]},
  storm: {name:"Picco pioggia · 24 h", title:"Massima pioggia in un giorno",
    copy:"Massima pioggia stimata in un giorno nel periodo selezionato.",
    tip:"I totali giornalieri non mostrano l’intensità dei temporali brevi.",
    unit:"mm", range:[0,100], stops:["#f4f8fc","#c0def0","#75b6df","#3f83bf","#225285"]},
  heat: {name:"Giorni caldi", title:"Giorni da 30 °C in su",
    copy:"Conta i giorni con massima stimata di almeno 30 °C.",
    tip:"Non indica la durata di un’ondata di caldo.",
    unit:"gg", range:[0,30], stops:["#f7f4e8","#f2d59a","#e2a05c","#c15f3e","#862f36"]},
  gdd: {name:"Calore per le colture", title:"Gradi-giorno sopra 10 °C",
    copy:"Con 16 °C di media in un giorno si aggiungono 6 gradi-giorno (°C·g); a 10 °C o meno non si aggiunge nulla.",
    tip:"È una misura del calore accumulato, non della resa agricola.",
    unit:"°C·g", range:[0,2500], stops:["#f4f3da","#c7d99a","#8bb56e","#4a8d62","#225746"]},
  mean: {name:"Temperatura media", title:"Temperatura media",
    copy:"Media delle temperature giornaliere stimate nel periodo.",
    tip:"La stima tiene conto della quota, ma può non rilevare le differenze tra versanti vicini.",
    unit:"°C", range:[-15,30], stops:["#3e488b","#7aa9ca","#f1efcf","#e9a85f","#9e3f37"]},
};
metrics.spring={...metrics.frost,name:"Gelo primaverile",title:"Giorni con gelo in primavera",
  copy:"Conta i giorni con minima stimata a 0 °C o meno, nella primavera in corso o nell’ultima conclusa."};
Object.assign(metrics,{
  min:{...metrics.mean,name:"Temperatura minima",title:"Temperatura minima",copy:"Minima stimata nel giorno indicato."},
  max:{...metrics.mean,name:"Temperatura massima",title:"Temperatura massima",copy:"Massima stimata nel giorno indicato."},
  rainDay:{...metrics.rain,name:"Pioggia del giorno",title:"Pioggia del giorno",
    copy:"Pioggia totale stimata nel giorno indicato. Un millimetro equivale a un litro per metro quadrato.",range:[0,60]},
});
for (const [key,span] of Object.entries(peakDays).slice(1)) {
  metrics[key] = {...metrics.storm, name:"Picco pioggia · "+span*24+" h",
    title:"Massima pioggia in "+span+" giorni",
    copy:"Massima pioggia stimata su "+span+" giorni consecutivi nel periodo selezionato.",
    tip:"I giorni iniziano a mezzanotte in ora solare (UTC+1).",
    range:[0,span===2 ? 150 : 200]};
}
const bands = {all:"Tutte le quote",low:"Meno di 800 m",mid:"Da 800 a 1.399 m",high:"Da 1.400 m"};
const bandBounds = {all:[0,5000],low:[0,800],mid:[800,1400],high:[1400,5000]};
const cities = [["Trento",11.121,46.068],["Rovereto",11.041,45.890],["Riva del Garda",10.842,45.886],
  ["Cles",11.034,46.361],["Malè",10.911,46.353],["Tione",10.727,46.032],
  ["Cavalese",11.461,46.290],["Canazei",11.774,46.476],["Borgo Valsugana",11.456,46.053],
  ["Fiera di Primiero",11.830,46.176],["Pinzolo",10.767,46.162]];
const views = ["mappa","valli","metodo"];
const dailyMetrics = ["min","max","rainDay"];
const metricOrder = [...dailyMetrics,"mean","frost","spring","heat","rain","storm","storm48","storm72","gdd"];
const province = {id:0,name:"Provincia di Trento"};
const state = {mapMetric:"min",compareMetric:"min",mapBand:"all",compareBand:"all",
  zone:0,comune:0,zoom:1,center:null,cell:null,station:null,dates:null,pairA:11,pairB:4,data:null,layers:new Map()};
const frame = $("atlas-map");
const it = new Intl.NumberFormat("it-IT",{maximumFractionDigits:1});
const fmt = v => it.format(v);
const pct = v => Math.round(v * 100) + "%";
const value = (number, key) => fmt(number) + " " + (metrics[key].unit==="gg" ? (fmt(number)==="1" ? "giorno" : "giorni") : metrics[key].unit);
const day = iso => new Intl.DateTimeFormat("it-IT",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(iso));
const shortDay = iso => new Intl.DateTimeFormat("it-IT",{day:"numeric",month:"short",timeZone:"UTC"}).format(new Date(iso));
const when = iso => new Intl.DateTimeFormat("it-IT",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Rome"}).format(new Date(iso));
const activeView = () => {
  const view=location.hash.slice(1).split("?")[0];
  return views.includes(view) ? view : "mappa";
};
function boundsFor(key) {
  const d = state.data;
  if (key === "gdd") return [d.seasonStart,d.seasonEnd];
  if (key === "spring") return [d.springStart,d.springEnd];
  if (dailyMetrics.includes(key)) {
    const end=state.dates?.[1] ?? d.latest;
    return [end,end];
  }
  if (state.dates) return state.dates;
  if (key === "heat") return [d.heatStart,d.heatEnd];
  return [key === "mean" ? d.latest : d.start,d.latest];
}
const period = key => {
  const [a,b] = boundsFor(key);
  return a === b ? day(a) : day(a) + " – " + day(b);
};
const selectedArea = () => state.comuneById[state.comune] ?? state.zoneById[state.zone] ?? province;
const normalize = s => s.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[’']/g,"'");

function mapHash(view=activeView(), overrides={}) {
  const s={...state,...overrides};
  const p=new URLSearchParams({m:s.mapMetric,b:s.mapBand,z:s.zone,zoom:s.zoom.toFixed(2),c:s.compareMetric,cb:s.compareBand,
    a:s.pairA,p:s.pairB});
  if (s.comune) p.set("comune",s.comune);
  if (s.center) p.set("centro",s.center.map(n=>n.toFixed(3)).join(","));
  if (s.cell!==null) p.set("punto",s.cell);
  if (s.station) p.set("stazione",s.station.id);
  if (s.dates) { p.set("dal",s.dates[0]); p.set("al",s.dates[1]); }
  if (s.stations) p.set("stazioni","1");
  return "#"+view+"?"+p;
}
function syncUrl() {
  if (!state.data) return;
  history.replaceState(null,"",mapHash());
  for (const anchor of document.querySelectorAll("a[data-view]")) {
    anchor.href=anchor.dataset.view==="valli" ? compareHash() : mapHash(anchor.dataset.view);
  }
  for (const anchor of $("compare-rows").querySelectorAll("a[data-zone]")) {
    anchor.href=mapHash("mappa",{mapMetric:state.compareMetric,mapBand:state.compareBand,
      zone:Number(anchor.dataset.zone),comune:0,zoom:1.55,center:null,cell:null,station:null});
  }
  $("map-compare").href=compareHash();
}
function compareHash() {
  const a=state.zone||state.pairA;
  return mapHash("valli",{compareMetric:state.mapMetric,compareBand:state.mapBand,pairA:a,pairB:a===state.pairB ? (a===11 ? 4 : 11) : state.pairB});
}
function restoreUrl() {
  const p=new URLSearchParams(location.hash.split("?")[1]), d=state.data;
  const pick=(object,key,fallback)=>Object.hasOwn(object,p.get(key)) ? p.get(key) : fallback;
  state.mapMetric=pick(d.layers,"m",d.layers.min ? "min" : "frost");
  state.compareMetric=pick(d.layers,"c",state.mapMetric);
  state.mapBand=pick(bands,"b","all");
  state.compareBand=pick(bands,"cb",state.mapBand);
  state.zone=Number(pick(state.zoneById,"z",0));
  state.pairA=Number(pick(state.zoneById,"a",11));
  state.pairB=Number(pick(state.zoneById,"p",4));
  state.comune=Number(pick(state.comuneById,"comune",0));
  if (!location.hash && state.comuneById[savedComune()]) {
    state.comune=savedComune();
    state.zone=zoneForComune(state.comune);
  }
  state.zoom=Math.min(12,Math.max(1,Number(p.get("zoom"))||(state.comune ? 4.2 : 1)));
  const center=p.get("centro")?.split(",").map(Number);
  state.center=center?.length===2 && center.every(Number.isFinite) ? center : null;
  const cell=p.get("punto");
  state.cell=cell && /^\d+$/.test(cell) && state.zoneArray[Number(cell)]>0 ? Number(cell) : null;
  state.station=d.stations.find(s=>String(s.id)===p.get("stazione")) ?? null;
  const from=p.get("dal"), to=p.get("al");
  const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && addDays(s,0)===s;
  const requested=iso(from) && iso(to) && from<=to;
  const dates=requested && from>=d.daily.start && to<=d.latest ? [from,to] : null;
  state.dates=state.daily ? dates : null;
  $("date-status").textContent=requested && !dates ? "Il periodo del link non è più disponibile. Mostro il periodo predefinito." : "";
  state.stations=p.get("stazioni")==="1";
  return dates;
}
function layerFor(key) {
  const d=state.data, [from,to]=boundsFor(key);
  const precomputed=key==="gdd" || key==="spring" || !state.dates;
  const id=[key,from,to,precomputed].join("/");
  if (state.layers.has(id)) return state.layers.get(id);
  const field=key==="frost" || key==="min" ? "min" : key==="heat" || key==="max" ? "max" : key==="mean" ? "mean" : "rain";
  const size=state.elevation.length;
  const packed=d.layers[key];
  const layer=precomputed ? {
    values:Float32Array.from(decode(packed.data), n=>n===-32768 ? NaN : n/packed.scale),
    peaks:packed.peaks ? decode(packed.peaks) : undefined
  } :
    aggregate(state.daily[field],size,dayIndex(from,d.daily.start),dayIndex(to,d.daily.start),key,d.daily.scale);
  if (state.layers.size>=12) state.layers.delete(state.layers.keys().next().value);
  state.layers.set(id,layer);
  return layer;
}
function peakText(key, index) {
  if (index==null || index<0) return "";
  const origin=state.data.daily.start;
  const end=addDays(origin,index), start=addDays(end,1-peakDays[key]);
  return start===end ? day(end) : day(start)+" – "+day(end);
}

function el(tag, content, cls) {
  const node = document.createElement(tag);
  if (content != null) node.textContent = content;
  if (cls) node.className = cls;
  return node;
}
function option(select, key, text) {
  select.add(new Option(text,key));
}
function decode(str) {
  const binary = atob(str), out = new Int16Array(binary.length / 2);
  for (let j=0;j<out.length;j++) out[j] = binary.charCodeAt(2*j) | (binary.charCodeAt(2*j+1) << 8);
  return out;
}
function createMetricControls(container, property, rerender) {
  for (const key of metricOrder) option(container,key,metrics[key].name);
  container.addEventListener("change",()=>{state[property]=container.value; rerender();});
}
function project(lon,lat) {
  const {west,north,dx,dy} = state.data.grid;
  return [(lon - west)/dx,(north - lat)/dy];
}
function zonePath(g) {
  const polygons = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  return polygons.map(p => p.map(r => r.map(([lon,lat],i) =>
    (i === 0 ? "M" : "L") + project(lon,lat).map(x => x.toFixed(2)).join(",")).join("") + "Z").join("")).join("");
}
function mapPoint(clientX,clientY) {
  const point=new DOMPoint(clientX,clientY).matrixTransform(frame.getScreenCTM().inverse());
  return [point.x,point.y];
}
function stationDescription(s) {
  return [["min","Minima","mean"],["mean","Media","mean"],["max","Massima","mean"],["rain","Pioggia","rain"]]
    .filter(([key])=>s[key]!=null).map(([key,label,metric])=>label+" "+value(s[key],metric)).join(" · ");
}
function setAreaOpen(open,focus=false) {
  $("area-panel").hidden=!open;
  $("show-area").setAttribute("aria-expanded",String(open));
  if (open && focus) $("close-area").focus();
}
const areaKey=()=>[state.comune,state.zone,state.cell,state.station?.id].join("/");
function closeArea(focus=false) {
  state.closedArea=areaKey();
  setAreaOpen(false);
  if (focus) $("show-area").focus();
}
function frostNote() {
  const p=el("p","Stima storica, non una previsione. ","stat-meta local-history");
  const link=el("a","Previsioni Meteotrentino","inline-link");
  link.href="https://www.meteotrentino.it/previsioni/";
  p.append(link);
  return p;
}
function readPoint() {
  const box=$("point-read"), i=state.cell, station=state.station;
  box.hidden=i===null && !station;
  if (box.hidden) { state.pin.setAttribute("visibility","hidden"); return; }
  const {w}=state.data.grid;
  const [x,y]=station ? project(station.lon,station.lat) : [i%w+.5,Math.floor(i/w)+.5];
  state.pin.setAttribute("cx",x);
  state.pin.setAttribute("cy",y);
  state.pin.removeAttribute("visibility");
  if (station) {
    box.replaceChildren(el("div",station.name+" · "+fmt(station.z)+" m","stat-tag"),
      el("strong","Misure della stazione · "+day(state.data.latest)),
      el("div",stationDescription(station)));
    return;
  }
  const [lo,hi]=bandBounds[state.mapBand];
  const z=state.elevation[i];
  const metric=state.mapMetric, layer=layerFor(metric), raw=layer.values[i], peak=peakText(metric,layer.peaks?.[i]);
  const available=z>=lo && z<hi && Number.isFinite(raw);
  box.replaceChildren(el("div","Stima nel punto · "+fmt(z)+" m","stat-tag"),
    el("div",available ? value(raw,metric) : z<lo || z>=hi ? "Fuori fascia di quota" : "Stima non disponibile",
      available ? "stat-big" : "stat-meta"),el("div",period(metric),"stat-meta"));
  if (peak && z>=lo && z<hi) box.append(el("div","Picco: "+peak));
  if (metric==="frost" || metric==="spring") box.append(frostNote());
}
function inspectPoint(point,station=null,focus=false) {
  const {w,h}=state.data.grid, [x,y]=point.map(Math.floor);
  const i=x>=0 && y>=0 && x<w && y<h ? y*w+x : -1;
  const zone=state.zoneArray[i];
  if (!station && !(zone>0)) {if (!$("area-panel").hidden) closeArea(); return;}
  state.center=state.camera;
  if (zone>0 || station.comune) {
    state.zone=zone>0 ? zone : 0;
    state.comune=station?.comune || state.comuneArray[i] || 0;
  }
  state.cell=station ? null : i;
  state.station=station;
  state.closedArea=null;
  $("map-zone").value=state.comune ? "" : String(state.zone);
  $("comune-search").value=state.comune ? selectedArea().name : "";
  drawSelection(); readZone(); readPoint(); syncUrl();
  setAreaOpen(true,focus);
}
function drawBase() {
  const d=state.data, {w,h}=d.grid;
  frame.replaceChildren();
  state.raster = svg("image",{x:0,y:0,width:w,height:h,"aria-hidden":"true","pointer-events":"none"});
  state.shapes=svg("g",{"aria-hidden":"true"});
  state.names=svg("g",{"aria-hidden":"true"});
  state.stationLayer=svg("g",{"aria-label":"Stazioni con misure nell’ultimo giorno"});
  state.pin=svg("circle",{class:"map-pin",visibility:"hidden","aria-hidden":"true"});
  const base=svg("image",{x:-85/3,y:-100/3,width:726/3,height:675/3,
    "aria-hidden":"true","pointer-events":"none"});
  state.basemap ??= fetchGzip("basemap.svg.gz","default").then(response=>response.text())
    .then(text=>"data:image/svg+xml;charset=utf-8,"+encodeURIComponent(text)).catch(()=>null);
  state.basemap.then(src=>{if (src) base.setAttribute("href",src);});
  frame.append(base,state.raster,state.shapes,state.names,state.stationLayer,state.pin);

  let minX=w,minY=h,maxX=0,maxY=0;
  for (let i=0;i<state.elevation.length;i++) if (state.elevation[i]!==-32768) {
    const x=i%w,y=Math.floor(i/w);
    minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
  }
  state.bounds=[minX-7,minY-7,maxX-minX+15,maxY-minY+15];
  for (const z of d.zones) {
    const path=svg("path",{d:zonePath(z.geometry),class:"zone-shape","data-zone":z.id,"fill-rule":"evenodd"});
    state.shapes.append(path);
  }
  state.selection=svg("path",{class:"zone-shape selected","fill-rule":"evenodd"});
  state.shapes.append(state.selection);
  for (const [index,[name,lon,lat]] of cities.entries()) {
    const [x,y]=project(lon,lat);
    const marker=svg("circle",{cx:x,cy:y,fill:"#233d53",stroke:"#fff","pointer-events":"none"});
    const label=svg("text",{x,y,class:"place-label"});
    label.textContent=name;
    const group=svg("g",{"data-rank":index});
    group.append(marker,label);
    state.names.append(group);
  }
  for (const [name,lon,lat] of [["ALTO ADIGE",11.40,46.55],["LOMBARDIA",10.41,46.18],["VENETO",11.82,45.94],["Lago di Garda",10.86,45.80]]) {
    const [x,y]=project(lon,lat);
    const label=svg("text",{x,y,class:"context-label","text-anchor":"middle"});
    label.textContent=name;
    state.names.append(label);
  }
  for (const s of d.stations) {
    const [x,y]=project(s.lon,s.lat);
    const circle=svg("circle",{cx:x,cy:y,class:"station",tabindex:0,role:"button",
      "aria-label":"Misure di "+s.name});
    circle.dataset.elevation=s.z;
    circle.addEventListener("click",event=>{event.stopPropagation();if (!blockClick) inspectPoint([x,y],s,event.detail===0);});
    circle.addEventListener("keydown",event=>{
      if (event.key!=="Enter" && event.key!==" ") return;
      event.preventDefault(); event.stopPropagation();
      inspectPoint([x,y],s,true);
    });
    state.stationLayer.append(circle);
  }
  toggleStations();
  updateZoom();
}
function drawSelection() {
  const {geometry}=selectedArea();
  state.selection.setAttribute("d",geometry ? zonePath(geometry) : "");
}
function toggleStations() {
  if (!state.stationLayer) return;
  const visible=!!state.stations;
  $("stations-toggle").setAttribute("aria-pressed",String(visible));
  $("stations-toggle").setAttribute("aria-label",visible ? "Nascondi stazioni" : "Mostra stazioni");
  $("stations-toggle").title=$("stations-toggle").getAttribute("aria-label");
  state.stationLayer.style.display=visible ? "" : "none";
  state.stationLayer.setAttribute("aria-hidden",String(!visible));
  const [lo,hi]=bandBounds[state.mapBand];
  for (const dot of state.stationLayer.children) dot.style.display=dot.dataset.elevation>=lo && dot.dataset.elevation<hi ? "" : "none";
}
const clamp=(v,min,max)=>Math.min(Math.max(v,min),max);
function viewport() {
  const rect=frame.getBoundingClientRect();
  const [, ,w,h]=state.bounds;
  const width=Math.max(1,rect.width), height=Math.max(1,rect.height);
  const mobile=width<=640;
  const scale=Math.max(w/Math.max(1,width-(mobile ? 2 : 24)),h/Math.max(1,height-Math.min(160,height*.25)))/state.zoom;
  return {rect,width:width*scale,height:height*scale,scale};
}
function updateZoom() {
  if (!state.bounds) return;
  const [x,y,w,h]=state.bounds, {width,height,scale}=viewport();
  const target=selectedArea().center;
  const [cx,cy]=state.center ?? (state.zoom>1 && target ? project(...target) : [x+w/2,y+h/2]);
  const limitX=Math.max(0,(w-width)/2), limitY=Math.max(0,(h-height)/2);
  state.camera=[clamp(cx,x+w/2-limitX,x+w/2+limitX), clamp(cy,y+h/2-limitY,y+h/2+limitY)];
  frame.setAttribute("viewBox",[state.camera[0]-width/2,state.camera[1]-height/2,width,height].join(" "));
  $("zoom-in").disabled=state.zoom>=12;
  $("zoom-out").disabled=state.zoom<=1;
  const narrow=frame.clientWidth<620;
  for (const group of state.names.querySelectorAll("g")) {
    group.style.display=narrow && state.zoom<1.65 && Number(group.dataset.rank)>3 ? "none" : "";
    const [dot,label]=group.children;
    dot.setAttribute("r",2.2*scale);
    dot.setAttribute("stroke-width",scale);
    label.setAttribute("dx",5*scale);
    label.setAttribute("dy",3*scale);
  }
  const visibleBoxes=[], left=state.camera[0]-width/2, top=state.camera[1]-height/2;
  for (const label of state.names.querySelectorAll("text")) {
    label.style.fontSize=(label.classList.contains("context-label") ? 10 : narrow ? 10 : 12)*scale+"px";
    label.style.strokeWidth=3*scale+"px";
    if (label.parentNode.style.display==="none") continue;
    const {x,y,width,height}=label.getBBox(), gap=3*scale;
    const overlaps=x<left+gap || x+width>left+frame.clientWidth*scale-gap ||
      y<top+gap || y+height>top+frame.clientHeight*scale-gap ||
      visibleBoxes.some(b=>x<b.x+b.width+gap && x+width+gap>b.x && y<b.y+b.height+gap && y+height+gap>b.y);
    label.setAttribute("visibility",overlaps ? "hidden" : "visible");
    if (!overlaps) visibleBoxes.push({x,y,width,height});
  }
  for (const dot of state.stationLayer.children) dot.setAttribute("r",5.5*scale);
  state.pin.setAttribute("r",6*scale);
}
function gradient(hexs,lo,hi,v) {
  const p=Math.max(0,Math.min(1,(v-lo)/(hi-lo)))*(hexs.length-1), a=Math.floor(p), b=Math.min(hexs.length-1,a+1);
  return hexs[a].map((v,j) => v+(hexs[b][j]-v)*(p-a));
}
function metricRange(key) {
  if (metrics[key].unit!=="gg") return metrics[key].range;
  const [a,b]=boundsFor(key);
  return [0,dayIndex(b,a)+1];
}
function renderRaster() {
  const d=state.data, {w,h}=d.grid, z=state.elevation, {values}=layerFor(state.mapMetric);
  const canvas=document.createElement("canvas"); canvas.width=w; canvas.height=h;
  const ctx=canvas.getContext("2d"), img=ctx.createImageData(w,h);
  const m=metrics[state.mapMetric], [low,high]=metricRange(state.mapMetric), [bandLo,bandHi]=bandBounds[state.mapBand];
  const colors=m.stops.map(c => [1,3,5].map(j => parseInt(c.slice(j,j+2),16)));
  for (let i=0;i<z.length;i++) {
    if (z[i]===-32768 || state.zoneArray[i]<=0) continue;
    const val=values[i], outside=z[i]<bandLo || z[i]>=bandHi;
    const rgb=outside ? [119,133,144] : !Number.isFinite(val) ? [239,237,223] : gradient(colors,low,high,val);
    for (let j=0;j<3;j++) img.data[4*i+j]=rgb[j];
    img.data[4*i+3]=outside ? 47 : !Number.isFinite(val) ? 35 : 204;
  }
  ctx.putImageData(img,0,0);
  state.raster.setAttribute("href",canvas.toDataURL());
}
function legend() {
  const m=metrics[state.mapMetric], [lo,hi]=metricRange(state.mapMetric);
  const labels=el("div",null,"legend-text");
  labels.append(el("span","Zone senza stima","no-data"));
  if (state.mapBand!=="all") labels.append(el("span",bands[state.mapBand],"out-band"));
  const ramp=el("div",null,"legend-ramp");
  ramp.style.background="linear-gradient(90deg,"+m.stops.join(",")+")";
  const scale=el("div",null,"legend-scale");
  scale.append(el("span",value(lo,state.mapMetric)),el("span",value((lo+hi)/2,state.mapMetric)),el("span",
    (m.unit==="gg" ? "" : "≥ ")+value(hi,state.mapMetric)));
  $("legend").replaceChildren(ramp,scale,labels);
}
function areaReading(id, band, key, grid=state.zoneArray) {
  const {values,peaks}=layerFor(key);
  return areaStats(values,grid,state.elevation,id,bandBounds[band],peaks);
}
function selectedReading() {
  return areaReading(selectedArea().id||null,state.mapBand,state.mapMetric,state.comune ? state.comuneArray : state.zoneArray);
}
function readZone() {
  const key=state.mapMetric, {cells,stats}=selectedReading();
  const box=$("zone-read");
  $("area-name").textContent=selectedArea().name;
  readLocalStation();
  readDailySummary();
  $("csv").disabled=!stats;
  if (!stats) {
    box.replaceChildren(el("p",cells ? "Nessuna stima per questa fascia e questo periodo." :
      "Non ci sono celle nella fascia di quota selezionata.","stat-meta"));
    return;
  }
  const label=state.comune ? "Media stimata nel comune" : state.zone ? "Media stimata nella valle" : "Media stimata in Trentino";
  const hasPoint=state.cell!==null || !!state.station;
  box.replaceChildren(el("div",metrics[key].title+" · "+label,"stat-tag"),
    el("div",value(stats.mean,key),hasPoint ? "stat-secondary" : "stat-big"),
    el("div",period(key)+" · Min "+fmt(stats.min)+" / max "+value(stats.max,key),"stat-meta"));
  const peak=peakText(key,stats.peak);
  if (peak) box.append(el("p","Picco locale: "+value(stats.max,key)+" · "+peak,"stat-meta"));
  if (!hasPoint && (key==="frost" || key==="spring")) box.append(frostNote());
  if (stats.coverage<.95) box.append(el("p","Stima disponibile per il "+pct(stats.coverage)+" dell’area selezionata.","stat-meta"));
}
function readLocalStation() {
  const box=$("local-station");
  box.hidden=true;
  const [from,to]=boundsFor(state.mapMetric);
  if (state.station || !state.comune || from!==to || to!==state.data.latest) return;
  const {w,west,north,dx,dy}=state.data.grid;
  const [x,y]=state.cell===null ? project(...selectedArea().center) : [state.cell%w+.5,Math.floor(state.cell/w)+.5];
  const i=state.cell ?? Math.floor(y)*w+Math.floor(x), z=state.elevation[i];
  if (!Number.isFinite(z) || z===-32768) return;
  const lon=west+x*dx, lat=north-y*dy;
  const km=s=>111.195*Math.hypot((s.lon-lon)*Math.cos(lat*Math.PI/180),s.lat-lat);
  const [lo,hi]=bandBounds[state.mapBand];
  const stations=state.data.stations.map(s=>({s,km:km(s),local:s.comune===state.comune}))
    .filter(({s,km})=>km<=15 && Math.abs(s.z-z)<=300 && s.z>=lo && s.z<hi)
    .sort((a,b)=>a.km-b.km);
  const [station]=stations;
  if (!station) return;
  const {s}=station;
  box.hidden=false;
  const context=(station.local ? "Nel comune · " : "")+fmt(station.km)+" km dal punto di riferimento · "+
    fmt(Math.abs(s.z-z))+" m di dislivello";
  box.replaceChildren(el("strong","Misure di stazione · "+day(state.data.latest)),
    el("span",s.name+" · "+fmt(s.z)+" m"),
    el("span",stationDescription(s)),el("small",context));
}
function savedComune() {
  try {return Number(localStorage.getItem("atlante-comune")) || 0;} catch {return 0;}
}
const dailyLabels=["Minima","Massima","Pioggia"];
function readDailySummary() {
  const section=$("daily-summary"), rows=state.data.comuneTrends?.[state.comune], saved=state.comune===savedComune();
  section.hidden=!rows;
  if (!rows) return;
  $("save-comune").textContent=saved ? "Rimuovi dai salvati" : "Salva per le prossime visite";
  $("save-comune").setAttribute("aria-pressed",String(saved));
  $("daily-heading").textContent="Ultimo giorno · "+shortDay(state.data.latest);
  $("daily-values").replaceChildren(...rows.at(-1).map((reading,i)=>{
    const item=el("div");
    item.append(el("span",dailyLabels[i],"stat-tag"),
      el("strong",reading===null ? "—" : value(reading,dailyMetrics[i])));
    return item;
  }));
  const table=el("tbody");
  rows.forEach((row,index)=>{
    const tr=el("tr"), date=el("th",shortDay(addDays(state.data.latest,index-rows.length+1)));
    date.scope="row";
    tr.append(date,...row.map((reading,i)=>el("td",reading===null ? "—" : value(reading,dailyMetrics[i]))));
    table.append(tr);
  });
  $("daily-table").querySelector("tbody").replaceWith(table);
}
$("save-comune").addEventListener("click",()=>{
  try {
    if (state.comune===savedComune()) localStorage.removeItem("atlante-comune");
    else localStorage.setItem("atlante-comune",state.comune);
    readDailySummary();
  } catch { $("daily-status").textContent="Il browser non consente di salvare il comune."; }
});
function chooseArea(zone,comune,{recenter=true,focus=false}={}) {
  state.zone=zone;
  state.comune=comune;
  state.cell=state.station=null;
  state.closedArea=null;
  if (recenter) {
    state.center=null;
    state.zoom=comune ? 4.2 : zone ? 2.4 : 1;
    updateZoom();
  }
  $("map-zone").value=comune ? "" : String(zone);
  $("comune-search").value=comune ? selectedArea().name : "";
  $("comune-results").replaceChildren();
  drawSelection(); readZone(); readPoint(); syncUrl();
  setAreaOpen(!!(zone||comune),focus);
}
let datesEdited=false;
function renderDates() {
  const key=activeView()==="valli" ? state.compareMetric : state.mapMetric;
  const fixed=key==="gdd" || key==="spring";
  const [from,to]=boundsFor(key), seasonal=fixed || (key==="heat" && !state.dates);
  const daily=dailyMetrics.includes(key);
  $("date-start").disabled=fixed || daily;
  $("date-end").disabled=fixed;
  $("date-start").closest("label").hidden=daily;
  if (!datesEdited) {
    const available=from>=state.data.daily.start && to<=state.data.latest && !fixed;
    $("date-start").value=available ? from : state.data.daily.start;
    $("date-end").value=available ? to : state.data.latest;
  }
  $("date-controls").querySelector(".fields").hidden=fixed;
  $("date-controls").querySelector('[type="submit"]').hidden=fixed || activeView()!=="valli";
  $("date-presets").hidden=fixed || daily;
  $("date-reset").hidden=!state.dates || fixed;
  const span=peakDays[key];
  $("date-hint").textContent=fixed ? period(key)+" · periodo stagionale" :
    span && dayIndex(to,from)+1<span ? "Seleziona almeno "+span+" giorni per questo indicatore." :
    seasonal ? period(key)+" · oppure scegli date negli ultimi 90 giorni." :
    "Date disponibili: "+day(state.data.daily.start)+" – "+day(state.data.latest)+".";
}
function periodWarning(key) {
  const span=peakDays[key], [from,to]=boundsFor(key);
  return span && dayIndex(to,from)+1<span ? "Per questo indicatore servono almeno "+span+" giorni consecutivi." : "";
}
function renderFilters() {
  const filters=[];
  if (state.mapBand!=="all") filters.push([bands[state.mapBand],()=>{state.mapBand="all";renderMap();}]);
  if (state.zone && !state.comune) filters.push([selectedArea().name,()=>chooseArea(0,0)]);
  if (state.dates && !["gdd","spring"].includes(state.mapMetric)) {
    const [from,to]=boundsFor(state.mapMetric);
    filters.push([from===to ? shortDay(to) : shortDay(from)+" – "+shortDay(to),()=>{state.dates=null;applyDateView();}]);
  }
  $("filter-count").textContent=filters.length;
  $("filter-count").hidden=!filters.length;
  $("active-filters").hidden=!filters.length;
  $("active-filters").replaceChildren(...filters.map(([label,reset])=>{
    const btn=el("button",label+" ×","active-chip");
    btn.type="button"; btn.setAttribute("aria-label","Rimuovi filtro: "+label);
    btn.addEventListener("click",()=>{reset();document.querySelector('[data-open="filters"]').focus();});
    return btn;
  }));
}
function renderMap() {
  if (!state.data) return;
  const key=state.mapMetric, m=metrics[key];
  for (const button of document.querySelectorAll("[data-metric]")) button.setAttribute("aria-pressed",String(button.dataset.metric===key));
  $("map-band").value=state.mapBand;
  $("map-zone").value=state.comune ? "" : String(state.zone);
  $("comune-search").value=state.comune ? selectedArea().name : "";
  $("metric-title").textContent=m.title;
  $("indicator-title").textContent=m.title;
  $("metric-copy").textContent=m.copy;
  $("metric-tip").textContent=m.tip;
  const [from,to]=boundsFor(key);
  const seasonal=["spring","gdd"].includes(key) || (key==="heat" && !state.dates);
  $("period").textContent=(from===to && to===state.data.latest ? "Ultimo giorno osservato: " : seasonal ? "Periodo stagionale: " : "")+period(key);
  const warning=periodWarning(key);
  $("period-warning").hidden=!warning;
  $("period-warning").textContent=warning;
  renderFilters();
  drawSelection(); renderRaster(); legend(); readZone(); readPoint(); renderDates(); toggleStations(); syncUrl();
}
function compare() {
  const key=state.compareMetric, band=state.compareBand, m=metrics[key];
  $("compare-metrics").value=key;
  if (!state.data) return;
  $("compare-band").value=band;
  $("compare-period").textContent=period(key)+(periodWarning(key) ? " · "+periodWarning(key) : "");
  $("sort-label").textContent=m.reverse ? "Media ↑" : "Media ↓";
  const score=s=>s?.coverage>=.6 ? 2 : s ? 1 : 0;
  const zones=state.data.zones.map(z=>[z,areaReading(z.id,band,key)]).map(([z,r])=>[z,r.stats,r.cells]).sort(([a,s],[b,t]) =>
    score(t)-score(s) || (m.reverse ? 1 : -1)*((s?.mean??0)-(t?.mean??0)) || a.name.localeCompare(b.name,"it"));
  const [first,top]=zones[0];
  const leaders=zones.filter(([,s])=>score(s)===2 && fmt(s.mean)===fmt(top?.mean));
  if (leaders.length>1) {
    const allZero=zones.every(([,s])=>score(s)!==2 || (s.min===0 && s.max===0));
    $("leader-text").textContent=allZero ? "Valori tutti a zero nelle valli con copertura sufficiente." :
      leaders.length+" valli hanno la stessa media alla precisione mostrata.";
  } else if (score(top)===2) {
    $("leader-text").textContent=(m.reverse ? "Media più bassa" : "Media più alta")+": "+first.name+", "+value(top.mean,key)+
      " ("+pct(top.coverage)+" delle celle). Classifica: almeno il 60% di celle con stima.";
  } else {
    $("leader-text").textContent="Nessuna valle ha una stima per almeno il 60% delle celle.";
  }
  $("caveat-text").textContent=(key==="gdd" ? "I gradi-giorno non misurano la resa. " :
    key==="rain" ? "Il totale non indica se la pioggia è sotto la media storica. " :
    peakDays[key] ? "I picchi delle singole celle possono cadere in date diverse. " : "")+
    "Anche nella stessa fascia, le valli possono avere quote medie diverse.";
  const body=$("compare-rows");
  body.replaceChildren();
  for (const [z,s,cells] of zones) {
    const tr=el("tr"), title=el("th",z.name), mean=el("td",s ? value(s.mean,key) : "—","bar-cell");
    title.scope="row";
    const mapLink=el("a","Mappa →","inline-link");
    mapLink.dataset.zone=z.id;
    mapLink.setAttribute("aria-label","Mostra "+z.name+" sulla mappa");
    const linkCell=el("td"); linkCell.append(mapLink);
    tr.append(title,mean,el("td",s ? fmt(s.min)+" – "+value(s.max,key) : "—"),
      el("td",s ? pct(s.coverage)+(score(s)===1 ? " · limitata" : "") : (cells ? "0%" : "Fuori fascia"),score(s)===1 ? "flag" : ""),linkCell);
    body.append(tr);
  }
  renderPair(); renderDates(); syncUrl();
}
function pairRows() {
  const {compareMetric:key,compareBand:band}=state;
  return [state.pairA,state.pairB].map(id=>[state.zoneById[id],areaReading(id,band,key).stats]);
}
function renderPair() {
  const key=state.compareMetric, band=state.compareBand;
  $("pair-a").value=state.pairA; $("pair-b").value=state.pairB;
  const rows=pairRows();
  const stats=rows.map(([z,s])=>z.name+": "+(s ? value(s.mean,key)+" ("+pct(s.coverage)+" di celle con stima)" : "nessuna stima"));
  const same=state.pairA===state.pairB;
  $("pair-caption").textContent=same ? "Scegli due valli diverse." :
    metrics[key].title+" · "+period(key)+" · "+bands[band]+". "+stats.join("; ")+". Fonte: Meteotrentino, elaborazioni dell’Atlante.";
  $("pair-values").replaceChildren(...(same ? [] : rows.map(([z,s])=>{
    const card=el("div",null,"pair-stat");
    card.append(el("b",z.name),el("strong",s ? value(s.mean,key) : "Nessuna stima"));
    if (s) card.append(el("span","Media stimata"+(s.coverage<.95 ? " · "+pct(s.coverage)+" del territorio in fascia" : "")),
      el("small","Quota media "+fmt(s.zMean)+" m · "+fmt(s.zMin)+"–"+fmt(s.zMax)+" m"));
    return card;
  })));
  const [[a,left],[b,right]]=rows, diff=left && right ? left.mean-right.mean : 0;
  $("pair-elevation").textContent=same ? "Scegli due valli diverse." :
    periodWarning(key) || (!left || !right ? (band!=="all" ? "Nessuna stima per almeno una valle in questa fascia. Prova tutte le quote." :
      "Nessuna stima per almeno una valle nel periodo selezionato.") :
    fmt(Math.abs(diff))==="0" ? "Medie uguali alla precisione mostrata." :
    "Scarto tra le medie: "+value(Math.abs(diff),key)+" in più per "+(diff>0 ? a.name : b.name)+".");
  $("pair-copy").disabled=same; $("pair-csv").disabled=same;
  $("pair-status").textContent="";
}
function showRoute() {
  datesEdited=false;
  const which=activeView();
  $(which==="valli" ? "compare-date-slot" : "map-date-slot").append($("date-controls"));
  $("date-controls").hidden=!state.data;
  for (const dialog of document.querySelectorAll("dialog[open]")) {
    if (dialog.id!==which) dialog.close();
  }
  if (which!=="mappa" && !$(which).open) {
    if (which==="valli") $(which).show(); else $(which).showModal();
  }
  updateZoom(); renderMap();
  if (which==="valli") compare();
}
async function fetchGzip(url, cache) {
  const response=await fetch(url,{cache});
  if (!response.ok) throw new Error("Dati non disponibili");
  return new Response(response.body.pipeThrough(new DecompressionStream("gzip")));
}
function loadHistory() {
  if (!state.history) state.history=(async()=>{
    const d=state.data;
    const stride=d.grid.w*d.grid.h*(dayIndex(d.latest,d.daily.start)+1)*2;
    const buffer=await (await fetchGzip("data/"+d.daily.file,"default")).arrayBuffer();
    if (buffer.byteLength!==stride*d.daily.keys.length) throw new Error("Serie giornaliera di dimensione inattesa");
    state.daily=Object.fromEntries(d.daily.keys.map((key,i)=>[key,new Int16Array(buffer,i*stride,stride/2)]));
  })().catch(error=>{state.history=null; throw error;});
  return state.history;
}
async function openSharedRoute() {
  const current=location.hash;
  const dates=restoreUrl();
  if (dates && !state.daily) {
    try {
      await loadHistory();
      if (location.hash!==current) return;
      state.dates=dates;
    } catch {
      if (location.hash!==current) return;
      $("date-status").textContent="Serie del link non disponibile. Mostro il periodo predefinito.";
    }
  }
  showRoute();
  setAreaOpen(!!(state.comune || state.zone || state.station || state.cell!==null) && state.closedArea!==areaKey());
}
async function populate(d) {
  state.data=d;
  state.daily=state.history=null;
  state.layers.clear();
  state.elevation=decode(d.elevation);
  state.zoneArray=decode(d.zoneGrid);
  state.comuneArray=decode(d.comuneGrid);
  state.zoneById=Object.fromEntries(d.zones.map(z=>[z.id,z]));
  state.comuneById=Object.fromEntries(d.comuni.map(z=>[z.id,z]));
  for (const button of document.querySelectorAll("[data-metric]")) button.hidden=!d.layers[button.dataset.metric];
  document.querySelector(".daily-switch").hidden=dailyMetrics.every(key=>!d.layers[key]);
  for (const opt of $("compare-metrics").options) opt.hidden=opt.disabled=!d.layers[opt.value];
  for (const id of ["map-zone","pair-a","pair-b"]) {
    $(id).replaceChildren();
    if (id==="map-zone") {
      const placeholder=new Option("Comune selezionato","");
      placeholder.disabled=true;
      $(id).add(placeholder);
      option($(id),0,"Tutto il Trentino");
    }
    for (const z of [...d.zones].sort((a,b)=>a.name.localeCompare(b.name,"it"))) option($(id),z.id,z.name);
  }
  for (const id of ["date-start","date-end"]) {
    $(id).replaceChildren();
    for (let date=d.latest;date>=d.daily.start;date=addDays(date,-1)) option($(id),date,day(date));
  }
  d.comuni.sort((a,b)=>a.name.localeCompare(b.name,"it"));
  $("latest").textContent=day(d.latest);
  const stale=Date.now()-Date.parse(d.latest)>3*86400000;
  $("source-status").textContent=stale ? "Ultimi dati disponibili (non recenti)" : "Ultimo giorno osservato";
  $("source-status").closest(".fresh").classList.toggle("stale",stale);
  $("network").textContent=d.stations.length+" stazioni · Meteotrentino";
  const modes={cron:"Pianificazione giornaliera",programma:"Pubblicazione pianificata",manual:"Esecuzione manuale",deploy:"Prima pubblicazione"};
  const run=$("run-data");
  run.replaceChildren();
  for (const [k,v] of [["Elaborato il",when(d.updatedAt)],["Versione archivio",d.sourceVersion],["Tipo di esecuzione",modes[d.trigger]??"Non disponibile"]]) {
    run.append(el("dt",k),el("dd",v));
  }
  const check=$("validation-data"); check.replaceChildren();
  for (const [k,label] of Object.entries({min:"Minima",mean:"Media",max:"Massima",rain:"Pioggia"})) {
    const {mae,n}=d.validation[k];
    check.append(el("dt",label),el("dd",mae==null ? "Non disponibile" :
      fmt(mae)+(k==="rain" ? " mm" : " °C")+" · "+n+" stazioni"));
  }
  $("validation-date").textContent=day(d.latest);
  drawBase(); await openSharedRoute();
}
async function load() {
  $("error").hidden=true;
  $("map-figure").hidden=false;
  $("map-figure").inert=true;
  $("source-status").textContent="Dati in caricamento";
  try {
    const d=await (await fetchGzip("data/atlas.json.gz","no-cache")).json();
    if (d.schema!==3 || !/^history-\d+-\d{8}T\d{4}\.bin\.gz$/.test(d.daily.file)) throw new Error("Formato dati non supportato");
    await populate(d);
    $("map-figure").inert=false;
    $("show-area").disabled=false;
  } catch (err) {
    console.error(err);
    $("error").hidden=false;
    $("map-figure").hidden=true;
    $("period").textContent="Dati non disponibili";
    $("source-status").textContent="Dati non disponibili";
    $("source-status").closest(".fresh").classList.add("stale");
  }
}

function comuneMatches() {
  const query=normalize($("comune-search").value.trim());
  if (!query || !state.data) return [];
  const matches=state.data.comuni.map(area=>[area,normalize(area.name)])
    .filter(([,name])=>name.includes(query));
  const rank=name=>name===query ? 0 : name.startsWith(query) ? 1 : 2;
  return matches.sort((a,b)=>rank(a[1])-rank(b[1])).slice(0,8).map(([area])=>area);
}
function zoneForComune(id) {
  const {w,h}=state.data.grid;
  const counts=new Map();
  for (let i=0;i<w*h;i++) if (state.comuneArray[i]===id && state.zoneArray[i]>0) {
    const z=state.zoneArray[i];
    counts.set(z,(counts.get(z)??0)+1);
  }
  return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? 0;
}
function openComune(area) {
  chooseArea(zoneForComune(area.id),area.id,{focus:true});
}
function download(blob, name) {
  const link=el("a");
  link.href=URL.createObjectURL(blob);
  link.download=name;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
function exportCsv(rows, key, band, level) {
  const [from,to]=boundsFor(key);
  const csvNum=new Intl.NumberFormat("it-IT",{maximumFractionDigits:2,useGrouping:false});
  const records=[
    ["Territorio","Livello","Indicatore","Unità","Fascia di quota","Dal","Al","Media","Minimo","Massimo di cella",
      "Celle con stima (%)","Celle con stima","Quota media (m)","Quota minima (m)","Quota massima (m)",
      "Picco dal","Picco al","Fonte","Versione"],
    ...rows.map(([area,s])=>{
      const end=s?.peak>=0 ? addDays(state.data.daily.start,s.peak) : "";
      const start=end ? addDays(end,1-peakDays[key]) : "";
      const figures=s ? [s.mean,s.min,s.max,s.coverage*100,s.count,s.zMean,s.zMin,s.zMax].map(n=>csvNum.format(n)) : Array(8).fill("");
      return [area.name,level,metrics[key].title,metrics[key].unit,bands[band],from,to,...figures,start,end,
        "Provincia Autonoma di Trento – Meteotrentino, CC BY 4.0; stime Atlante Meteo Trentino",state.data.sourceVersion];
    }),
  ];
  const data=records.map(row=>row.map(s=>'"'+String(s).replaceAll('"','""')+'"').join(";")).join("\r\n");
  download(new Blob(["\ufeff",data,"\r\n"],{type:"text/csv;charset=utf-8"}),"atlante-"+key+"-"+to+".csv");
}
async function exportPng() {
  await state.basemap;
  const key=state.mapMetric, clone=frame.cloneNode(true), width=1200,height=940;
  clone.setAttribute("width",width); clone.setAttribute("height",height-176);
  clone.querySelectorAll(".zone-shape").forEach(p=>{
    p.setAttribute("fill","none"); p.setAttribute("stroke","#29443c");
    p.setAttribute("stroke-opacity",p.classList.contains("selected") ? "1" : ".55");
    p.setAttribute("stroke-width",p.classList.contains("selected") ? "2.5" : "1.1");
    p.setAttribute("vector-effect","non-scaling-stroke");
  });
  clone.querySelectorAll(".place-label").forEach(p=>{
    p.style.fontFamily="sans-serif"; p.style.fill="#203a31"; p.style.stroke="#f5f6e9"; p.style.paintOrder="stroke";
  });
  clone.querySelectorAll(".station").forEach(p=>{p.setAttribute("fill","#2f4f42");p.setAttribute("stroke","#fff");});
  const img=new Image();
  img.src="data:image/svg+xml;charset=utf-8,"+encodeURIComponent(new XMLSerializer().serializeToString(clone));
  await img.decode();
  const canvas=el("canvas"); canvas.width=width; canvas.height=height;
  const ctx=canvas.getContext("2d"), m=metrics[key], [low,high]=metricRange(key);
  ctx.fillStyle="#e8eee4"; ctx.fillRect(0,0,width,height); ctx.drawImage(img,0,92);
  ctx.fillStyle="#203a31"; ctx.font="bold 31px sans-serif"; ctx.fillText(m.title+" · "+selectedArea().name,32,47,width-64);
  ctx.font="20px sans-serif"; ctx.fillText(period(key)+" · "+bands[state.mapBand],32,77);
  const ramp=ctx.createLinearGradient(32,0,432,0);
  m.stops.forEach((color,i)=>ramp.addColorStop(i/(m.stops.length-1),color));
  ctx.fillStyle=ramp; ctx.fillRect(32,862,400,14);
  ctx.fillStyle="#203a31"; ctx.font="17px sans-serif";
  ctx.fillText(value(low,key),32,897);
  ctx.textAlign="right"; ctx.fillText(value(high,key),432,897); ctx.textAlign="left";
  ctx.fillText("Senza colore: nessuna stima"+(state.mapBand==="all" ? "" : " · Grigio: fuori fascia"),468,876);
  ctx.fillText("Meteotrentino · TINITALY (INGV) · Provincia autonoma di Trento · © OpenStreetMap / OpenMapTiles · Non è una previsione",32,924);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
  if (!blob) throw new Error("Immagine non disponibile");
  download(blob,"atlante-"+key+"-"+boundsFor(key)[1]+".png");
}
function shareUrl(view,key) {
  const url=new URL(location.href);
  const fixed=key==="gdd" || key==="spring" || (key==="heat" && !state.dates);
  url.hash=mapHash(view,{dates:fixed ? state.dates : boundsFor(key)});
  return url.href;
}
function applyDateView() {
  datesEdited=false;
  $("date-status").textContent="";
  renderMap();
  if (activeView()==="valli") compare();
}

const metricGroups={
  "Temperatura":["min","max","mean","frost","spring","heat"],
  "Pioggia":["rainDay","rain","storm","storm48","storm72"],
  "Colture":["gdd"],
};
for (const [label,keys] of Object.entries(metricGroups)) {
  const group=el("section",null,"metric-group");
  group.append(el("h3",label));
  for (const key of keys) {
    const button=el("button",null,"metric-option");
    button.type="button";
    button.dataset.metric=key;
    button.append(el("strong",metrics[key].title),el("span",metrics[key].copy));
    group.append(button);
  }
  $("metric-options").append(group);
}
for (const button of document.querySelectorAll("[data-metric]")) button.addEventListener("click",()=>{
  if (!state.data) return;
  if ($("metric-picker").open) closeSheet($("metric-picker"));
  state.mapMetric=button.dataset.metric;
  renderMap();
});
createMetricControls($("compare-metrics"),"compareMetric",()=>{datesEdited=false;compare();});
for (const [k,label] of Object.entries(bands)) {
  option($("map-band"),k,label); option($("compare-band"),k,label);
}
$("map-band").addEventListener("change", e=>{state.mapBand=e.target.value;renderMap();});
$("compare-band").addEventListener("change", e=>{state.compareBand=e.target.value;compare();});
$("map-zone").addEventListener("change",e=>chooseArea(Number(e.target.value),0));
$("comune-search").addEventListener("input",()=>{
  const results=$("comune-results"), matches=comuneMatches();
  results.replaceChildren();
  for (const area of matches) {
    const button=el("button",area.name);
    button.type="button";
    button.addEventListener("click",()=>openComune(area));
    const li=el("li"); li.append(button); results.append(li);
  }
  if ($("comune-search").value.trim() && !matches.length) results.append(el("li","Nessun comune trovato."));
});
$("comune-form").addEventListener("keydown",event=>{
  const buttons=[...$("comune-results").querySelectorAll("button")];
  if (event.key==="Escape") {
    $("comune-results").replaceChildren();
    $("comune-search").focus();
  } else if (buttons.length && ["ArrowDown","ArrowUp"].includes(event.key)) {
    event.preventDefault();
    const index=buttons.indexOf(document.activeElement);
    const next=event.key==="ArrowDown" ? index+1 : index<0 ? buttons.length-1 : index-1;
    (buttons[next] ?? $("comune-search")).focus();
  }
});
document.addEventListener("focusin",event=>{
  if (!$("comune-form").contains(event.target)) $("comune-results").replaceChildren();
});
document.addEventListener("pointerdown",event=>{
  if (!$("comune-form").contains(event.target)) $("comune-results").replaceChildren();
});
$("comune-form").addEventListener("submit",event=>{
  event.preventDefault();
  const [area]=comuneMatches();
  if (area) openComune(area);
});
async function submitDates(close=false) {
  if (!state.data) return;
  const key=activeView()==="valli" ? state.compareMetric : state.mapMetric;
  const b=$("date-end").value, a=dailyMetrics.includes(key) ? b : $("date-start").value;
  if (!datesEdited || ["spring","gdd"].includes(key) || (a===boundsFor(key)[0] && b===boundsFor(key)[1])) {
    if (close) closeSheet($("filters"));
    return;
  }
  if (a>b) { $("date-status").textContent="La data iniziale deve precedere o coincidere con quella finale."; return; }
  const span=peakDays[key];
  if (span && dayIndex(b,a)+1<span) { $("date-status").textContent="Scegli almeno "+span+" giorni consecutivi."; return; }
  const before=location.hash;
  if (!state.daily) {
    $("date-status").textContent="Caricamento delle serie giornaliere…";
    try { await loadHistory(); }
    catch { $("date-status").textContent="Serie giornaliere non disponibili. Riprova."; return; }
    if (location.hash!==before || (!dailyMetrics.includes(key) && $("date-start").value!==a) || $("date-end").value!==b ||
        !(close ? $("filters") : $("valli")).open) return;
  }
  state.dates=[a,b]; applyDateView();
  if (close) closeSheet($("filters"));
}
$("date-controls").addEventListener("submit",event=>{
  event.preventDefault();
  submitDates($("filters").open);
});
$("date-reset").addEventListener("click",()=>{state.dates=null;applyDateView();});
for (const id of ["date-start","date-end"]) $(id).addEventListener("change",()=>{datesEdited=true;});
for (const button of $("date-presets").children) button.addEventListener("click",()=>{
  $("date-end").value=state.data.latest;
  $("date-start").value=addDays(state.data.latest,1-Number(button.dataset.days));
  datesEdited=true;
  $("date-status").textContent="";
});
$("stations-toggle").addEventListener("click",()=>{state.stations=!state.stations;renderMap();});
const openers=new WeakMap();
for (const button of document.querySelectorAll("[data-open]")) {
  button.addEventListener("click",()=>{
    const target=$(button.dataset.open);
    if (target.open) {closeSheet(target);return;}
    for (const other of document.querySelectorAll("dialog[open]")) closeSheet(other,false);
    openers.set(target,button);
    if (target.matches(".dock")) {
      if (target.id==="share" || target.id==="metric-picker") {
        target.style.setProperty("--panel-left",button.getBoundingClientRect().left+"px");
      }
      target.show();
    } else target.showModal();
  });
}
for (const anchor of document.querySelectorAll('a[data-view="valli"],a[data-view="metodo"],#map-compare')) {
  anchor.addEventListener("click",()=>{
    openers.set($(anchor=== $("map-compare") ? "valli" : anchor.dataset.view),anchor);
  });
}
function closeSheet(dialog,focus=true) {
  dialog.close();
  if (dialog.id==="filters" || dialog.id==="valli") {
    datesEdited=false;
    if (state.data) renderDates();
    $("date-status").textContent="";
  }
  if (dialog.id==="valli" || dialog.id==="metodo") {
    history.replaceState(null,"",mapHash("mappa"));
    showRoute();
  }
  if (focus) (openers.get(dialog) ?? (dialog.id==="valli" ? $("link-valli") : $("link-metodo"))).focus();
}
for (const dialog of document.querySelectorAll("dialog")) {
  dialog.querySelector("[data-close]").addEventListener("click",()=>closeSheet(dialog));
  dialog.addEventListener("cancel",event=>{event.preventDefault();closeSheet(dialog);});
  dialog.addEventListener("click",event=>{
    if (event.target!==dialog || dialog.matches(".dock")) return;
    const r=dialog.getBoundingClientRect();
    if (event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom) closeSheet(dialog);
  });
}
document.addEventListener("click",event=>{
  const target=document.querySelector("dialog.dock[open]");
  if (target && !target.contains(event.target) && !event.target.closest("[data-open],a[data-view],#map-compare")) closeSheet(target,false);
});
document.addEventListener("keydown",event=>{
  if (event.key!=="Escape" || event.defaultPrevented) return;
  const target=document.querySelector("dialog[open]");
  if (target?.matches(".dock")) {event.preventDefault();closeSheet(target);}
  if (!target && !$("area-panel").hidden) {event.preventDefault();closeArea(true);}
});
$("show-area").addEventListener("click",()=>{
  if ($("area-panel").hidden) {state.closedArea=null;setAreaOpen(true,true);}
  else closeArea(true);
});
$("close-area").addEventListener("click",()=>closeArea(true));
$("copy-link").addEventListener("click",async()=>{
  if (!state.data) return;
  const url=shareUrl("mappa",state.mapMetric);
  try {
    await navigator.clipboard.writeText(url);
    $("share-url").hidden=true;
    $("share-status").textContent="Link copiato.";
  } catch {
    const field=$("share-url");
    field.hidden=false; field.value=url; field.select();
    $("share-status").textContent="Copia il link dal campo selezionato.";
  }
});
$("csv").addEventListener("click",()=>{if (state.data) exportCsv([[selectedArea(),selectedReading().stats]],
  state.mapMetric,state.mapBand,state.comune ? "Comune" : state.zone ? "Comunità di valle" : "Provincia");});
$("pair-a").addEventListener("change",e=>{state.pairA=Number(e.target.value);renderPair();syncUrl();});
$("pair-b").addEventListener("change",e=>{state.pairB=Number(e.target.value);renderPair();syncUrl();});
$("pair-csv").addEventListener("click",()=>exportCsv(pairRows(),state.compareMetric,state.compareBand,"Comunità di valle"));
$("pair-copy").addEventListener("click",async()=>{
  const text=$("pair-caption").textContent+"\n"+shareUrl("valli",state.compareMetric);
  try {
    await navigator.clipboard.writeText(text);
    $("pair-status").textContent="Didascalia e link copiati.";
  } catch {
    $("pair-status").textContent=text;
  }
});
$("png").addEventListener("click",()=>{if (state.data) exportPng().catch(()=>{
  $("share-status").textContent="Immagine non disponibile. Prova Stampa / PDF.";
});});
$("print").addEventListener("click",()=>{
  if (state.data) { closeSheet($("share")); window.print(); }
});
$("retry").addEventListener("click",load);
document.querySelector(".skip").addEventListener("click",event=>{
  event.preventDefault();
  frame.focus();
});
function moveCamera(zoom,anchor,clientX,clientY) {
  state.zoom=clamp(zoom,1,12);
  const {rect,scale}=viewport();
  state.center=[anchor[0]-(clientX-rect.left-rect.width/2)*scale,anchor[1]-(clientY-rect.top-rect.height/2)*scale];
  updateZoom();
  state.center=state.camera;
}
function zoomAt(zoom,clientX,clientY) {
  if (!state.data) return;
  const rect=frame.getBoundingClientRect();
  const x=clientX ?? rect.left+rect.width/2, y=clientY ?? rect.top+rect.height/2;
  moveCamera(zoom,mapPoint(x,y),x,y);
  syncUrl();
}
function resetCamera() {
  if (!state.data) return;
  state.zoom=1; state.center=null; updateZoom(); syncUrl();
}
$("zoom-in").addEventListener("click",()=>zoomAt(state.zoom*1.5));
$("zoom-out").addEventListener("click",()=>zoomAt(state.zoom/1.5));
$("zoom-reset").addEventListener("click",resetCamera);
new ResizeObserver(updateZoom).observe(frame);
document.fonts.ready.then(updateZoom);
frame.addEventListener("wheel",event=>{
  if (!state.data) return;
  if (event.ctrlKey && event.deltaMode!==0) return;
  event.preventDefault();
  const pixels=event.deltaY*(event.deltaMode===1 ? 16 : event.deltaMode===2 ? 300 : 1);
  zoomAt(state.zoom*Math.exp(-clamp(pixels,-160,160)*.0035),event.clientX,event.clientY);
},{passive:false});
frame.addEventListener("dblclick",event=>{
  if (!state.data || event.target.closest(".station")) return;
  zoomAt(state.zoom*1.7,event.clientX,event.clientY);
});
frame.addEventListener("keydown",event=>{
  if (!state.data || event.target!==frame || event.altKey || event.metaKey || event.ctrlKey) return;
  const dirs={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
  if (event.key in dirs) {
    const {scale}=viewport();
    state.center=state.camera.map((v,i)=>v+dirs[event.key][i]*scale*48);
    updateZoom(); state.center=state.camera; syncUrl();
  } else if (["=","+","-"].includes(event.key)) {
    zoomAt(state.zoom*(event.key==="-" ? 1/1.5 : 1.5));
  } else if (event.key==="Home") resetCamera();
  else if (event.key==="Enter") inspectPoint(state.camera,null,true);
  else return;
  event.preventDefault();
});
const pointers=new Map();
let gesture=null,blockClick=false;
function pointerCenter() {
  const [a,b]=pointers.values();
  return b ? [(a[0]+b[0])/2,(a[1]+b[1])/2,Math.hypot(a[0]-b[0],a[1]-b[1])] : [...a,1];
}
function startGesture() {
  const [x,y,distance]=pointerCenter();
  gesture={x,y,distance,zoom:state.zoom,anchor:mapPoint(x,y)};
}
function captureGesture() {
  blockClick=true;
  frame.classList.add("dragging");
  for (const id of pointers.keys()) if (!frame.hasPointerCapture(id)) frame.setPointerCapture(id);
}
frame.addEventListener("pointerdown",event=>{
  if (!state.data || event.button!==0 || pointers.size>=2) return;
  if (!pointers.size) blockClick=false;
  pointers.set(event.pointerId,[event.clientX,event.clientY]);
  startGesture();
  if (pointers.size===2) captureGesture();
});
frame.addEventListener("pointermove",event=>{
  if (!pointers.has(event.pointerId)) return;
  pointers.set(event.pointerId,[event.clientX,event.clientY]);
  const [x,y,distance]=pointerCenter();
  if (!blockClick && Math.hypot(x-gesture.x,y-gesture.y)<5) return;
  if (!blockClick) captureGesture();
  const ratio=pointers.size===2 && gesture.distance>0 ? distance/gesture.distance : 1;
  moveCamera(gesture.zoom*ratio,gesture.anchor,x,y);
});
function endGesture(event) {
  if (!pointers.delete(event.pointerId)) return;
  if (pointers.size) startGesture();
  else {
    gesture=null;
    frame.classList.remove("dragging");
    if (blockClick) syncUrl();
  }
}
window.addEventListener("pointerup",endGesture);
window.addEventListener("pointercancel",endGesture);
frame.addEventListener("click",event=>{
  if (state.data && !blockClick) inspectPoint(mapPoint(event.clientX,event.clientY));
});
window.addEventListener("hashchange",()=>{
  if (state.data) openSharedRoute(); else showRoute();
});
showRoute();
load();
