import {addDays, dayIndex, peakDays, aggregate, areaStats} from "./indicators.mjs";

const $ = id => document.getElementById(id);
const svg = (name, attrs = {}) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
};
const metrics = {
  frost: {name:"Gelo recente", title:"Giorni con gelo", icon:"M8 1v14M2 5l12 6M2 11l12-6M6 3l2 2 2-2M6 13l2-2 2 2",
    copy:"Conta i giorni in cui la temperatura minima stimata è scesa a 0 °C o meno.",
    tip:"Più giorni colorati indicano gelate più frequenti. Il gelo vicino al suolo può differire dalla temperatura dell’aria.",
    unit:"gg", range:[0,30], stops:["#f3f6f3","#bddae3","#6aa7cd","#425da2","#303464"]},
  rain: {name:"Accumulo pioggia", title:"Pioggia accumulata", icon:"M8 1S3 7 3 10a5 5 0 0 0 10 0c0-3-5-9-5-9z",
    copy:"Mostra la pioggia stimata nel periodo, sommata per giorni solari.",
    tip:"Senza un riferimento storico locale non sappiamo se l’accumulo è minore del normale. Non è un indicatore di siccità.",
    unit:"mm", range:[0,180], stops:["#955020","#d2924d","#f4e6b9","#75a9a1","#285b78"], reverse:true},
  storm: {name:"Piogge intense", title:"Massima pioggia in un giorno", icon:"M4 9H12a3 3 0 0 0 0-6 4 4 0 0 0-7-.5A3.3 3.3 0 0 0 4 9zm2 2-1 3m4-3-1 3m4-3-1 3",
    copy:"Indica il massimo accumulo stimato in una singola giornata del periodo.",
    tip:"I totali giornalieri non misurano i picchi di pochi minuti e non sono soglie di allerta.",
    unit:"mm", range:[0,100], stops:["#eef4ee","#9fcacb","#559ba8","#536ca9","#3c3877"]},
  heat: {name:"Caldo", title:"Giorni di caldo intenso", icon:"M8 1v2m0 10v2M1 8h2m10 0h2M3 3l1.4 1.4m7.2 7.2L13 13M3 13l1.4-1.4m7.2-7.2L13 3M11.4 8a3.4 3.4 0 1 1-6.8 0 3.4 3.4 0 0 1 6.8 0z",
    copy:"Conta i giorni con massima stimata di almeno 30 °C.",
    tip:"Misura la frequenza del caldo diurno, non la durata di un’ondata né lo stress termico delle persone.",
    unit:"gg", range:[0,30], stops:["#f7f4e8","#f2d59a","#e2a05c","#c15f3e","#862f36"]},
  gdd: {name:"Calore disponibile", title:"Somma termica della stagione", icon:"M8 15V7m0 4C7 6 3 5 1 6c0 4 3 6 7 5zm0-3c1-5 4-6 7-6 0 4-3 6-7 6z",
    copy:"Con 16 °C di media in un giorno si aggiungono 6 gradi-giorno (°C·g); a 10 °C o meno non si aggiunge nulla.",
    tip:"Una somma più alta indica più calore disponibile, non necessariamente rese migliori. Confronta fasce di quota simili.",
    unit:"°C·g", range:[0,2500], stops:["#f4f3da","#c7d99a","#8bb56e","#4a8d62","#225746"]},
  mean: {name:"Temperatura", title:"Temperatura media", icon:"M7 2a1.5 1.5 0 0 1 3 0v7a3.2 3.2 0 1 1-3 0zm1.5 4v5m0 0v1",
    copy:"Mostra la temperatura media stimata nei giorni del periodo.",
    tip:"Le stime tengono conto della quota ma non rappresentano tutti i microclimi di un singolo versante.",
    unit:"°C", range:[-15,30], stops:["#3e488b","#7aa9ca","#f1efcf","#e9a85f","#9e3f37"]},
};
metrics.spring={...metrics.frost,name:"Gelo primaverile",title:"Giorni con gelo in primavera",
  copy:"Conta i giorni con minima stimata a 0 °C o meno, nella primavera in corso o nell’ultima conclusa."};
for (const [key,span] of Object.entries(peakDays).slice(1)) {
  metrics[key] = {...metrics.storm, name:"Pioggia "+span*24+" h",
    title:"Massima pioggia in "+span+" giorni",
    copy:"Indica il massimo accumulo stimato su "+span+" giorni solari consecutivi nel periodo.",
    tip:"Le finestre iniziano a mezzanotte (ora solare), non in qualsiasi ora. Non sono soglie di allerta.",
    range:[0,span===2 ? 150 : 200]};
}
const bands = {all:"Tutte le quote",low:"Meno di 800 m",mid:"Da 800 a 1.399 m",high:"Da 1.400 m"};
const bandBounds = {all:[0,5000],low:[0,800],mid:[800,1400],high:[1400,5000]};
const cities = [["Trento",11.121,46.068],["Rovereto",11.041,45.890],["Riva del Garda",10.842,45.886],
  ["Cles",11.034,46.361],["Malè",10.911,46.353],["Tione",10.727,46.032],
  ["Cavalese",11.461,46.290],["Canazei",11.774,46.476],["Borgo Valsugana",11.456,46.053],
  ["Fiera di Primiero",11.830,46.176],["Pinzolo",10.767,46.162]];
const nav = {
  mappa:["Il meteo, valle per valle.","Dalle stazioni al territorio: esplora gelo, caldo e piogge, oppure confronta il calore disponibile per le colture."],
  valli:["Il meteo a confronto.","Confronta le stime nello stesso periodo e nella stessa fascia di quota. Non descrivono il clima di lungo periodo."],
  metodo:["Dalle misure alla mappa.","Da dove arrivano i dati, come diventano stime territoriali e cosa non possiamo concludere."],
};
const state = {mapMetric:"frost",compareMetric:"gdd",mapBand:"all",compareBand:"low",
  zone:11,comune:0,zoom:1,dates:null,pairA:11,pairB:4,data:null,layers:new Map()};
const frame = $("atlas-map");
const it = new Intl.NumberFormat("it-IT",{maximumFractionDigits:1});
const fmt = v => it.format(v);
const pct = v => Math.round(v * 100) + "%";
const value = (number, key) => fmt(number) + " " + metrics[key].unit;
const day = iso => new Intl.DateTimeFormat("it-IT",{day:"numeric",month:"short",year:"numeric",timeZone:"UTC"}).format(new Date(iso));
const when = iso => new Intl.DateTimeFormat("it-IT",{dateStyle:"short",timeStyle:"short",timeZone:"Europe/Rome"}).format(new Date(iso));
const activeView = () => {
  const view=location.hash.slice(1).split("?")[0];
  return Object.hasOwn(nav,view) ? view : "mappa";
};
function boundsFor(key) {
  const d = state.data;
  if (key === "gdd") return [d.seasonStart,d.seasonEnd];
  if (key === "spring") return [d.springStart,d.springEnd];
  if (state.dates) return state.dates;
  if (key === "heat") return [d.heatStart,d.heatEnd];
  return [key === "mean" ? d.latest : d.start,d.latest];
}
const period = key => {
  const [a,b] = boundsFor(key);
  return a === b ? day(a) : day(a) + " – " + day(b);
};
const selectedArea = () => state.comune ? state.comuneById[state.comune] : state.zoneById[state.zone];
const normalize = s => s.normalize("NFD").replace(/\p{Diacritic}/gu,"").toLowerCase().replace(/[’']/g,"'");

function mapHash(view=activeView(), overrides={}) {
  const s={...state,...overrides};
  const p=new URLSearchParams({m:s.mapMetric,b:s.mapBand,z:s.zone,zoom:s.zoom.toFixed(2),c:s.compareMetric,cb:s.compareBand,
    a:s.pairA,p:s.pairB});
  if (s.comune) p.set("comune",s.comune);
  if (s.dates) { p.set("dal",s.dates[0]); p.set("al",s.dates[1]); }
  if (s.stations ?? $("show-stations").checked) p.set("stazioni","1");
  return "#"+view+"?"+p;
}
function syncUrl() {
  if (!state.data) return;
  history.replaceState(null,"",mapHash());
  for (const anchor of document.querySelectorAll("a[data-view]")) anchor.href=mapHash(anchor.dataset.view);
  for (const anchor of $("compare-rows").querySelectorAll("a[data-zone]")) {
    anchor.href=mapHash("mappa",{mapMetric:state.compareMetric,mapBand:state.compareBand,
      zone:Number(anchor.dataset.zone),comune:0,zoom:1.55});
  }
  $("map-compare").href=mapHash("valli",{compareMetric:state.mapMetric,compareBand:state.mapBand,pairA:state.zone});
}
function restoreUrl() {
  const p=new URLSearchParams(location.hash.split("?")[1]), d=state.data;
  const pick=(object,key,fallback)=>Object.hasOwn(object,p.get(key)) ? p.get(key) : fallback;
  state.mapMetric=pick(metrics,"m","frost");
  state.compareMetric=pick(metrics,"c","gdd");
  state.mapBand=pick(bands,"b","all");
  state.compareBand=pick(bands,"cb","low");
  state.zone=Number(pick(state.zoneById,"z",11));
  state.pairA=Number(pick(state.zoneById,"a",11));
  state.pairB=Number(pick(state.zoneById,"p",4));
  state.comune=Number(pick(state.comuneById,"comune",0));
  state.zoom=Math.min(3,Math.max(1,Number(p.get("zoom"))||1));
  const from=p.get("dal"), to=p.get("al");
  const iso=s=>/^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(s)) && addDays(s,0)===s;
  const requested=iso(from) && iso(to) && from<=to;
  state.dates=requested && from>=d.daily.start && to<=d.latest ? [from,to] : null;
  $("date-status").textContent=requested && !state.dates ? "Il periodo del link non è più disponibile. Mostro il periodo predefinito." : "";
  $("show-stations").checked=p.get("stazioni")==="1";
}
function layerFor(key) {
  const d=state.data, [from,to]=boundsFor(key);
  const seasonLayer=key==="gdd" || key==="spring" || (key==="heat" && !state.dates);
  const id=[key,from,to,seasonLayer].join("/");
  if (state.layers.has(id)) return state.layers.get(id);
  const field=key==="frost" ? "min" : key==="heat" ? "max" : key==="mean" ? "mean" : "rain";
  const size=state.elevation.length;
  const layer=seasonLayer ? {values:Float32Array.from(decode(d.layers[key].data), n=>n===-32768 ? NaN : n/d.layers[key].scale)} :
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
  for (const [key,m] of Object.entries(metrics)) {
    const button = el("button");
    button.type = "button";
    button.dataset.key = key;
    const icon = svg("svg",{viewBox:"0 0 16 16","aria-hidden":"true"});
    icon.append(svg("path",{d:m.icon}));
    button.append(icon,document.createTextNode(m.name));
    button.addEventListener("click", () => { state[property] = key; rerender(); });
    container.append(button);
  }
}
function pressed(container, key) {
  for (const button of container.children) button.setAttribute("aria-pressed",String(button.dataset.key === key));
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
function hideTooltip() { $("tooltip").hidden=true; }
function tooltip(x,y,title,text) {
  const box=$("tooltip"), map=$("map-figure").getBoundingClientRect();
  box.replaceChildren(el("strong",title),el("div",text));
  box.hidden=false;
  box.style.left=Math.max(5,Math.min(x-map.left+9,map.width-box.offsetWidth-5))+"px";
  box.style.top=Math.max(5,Math.min(y-map.top+9,map.height-box.offsetHeight-5))+"px";
}
function positionFromPointer(event) {
  const p = new DOMPoint(event.clientX,event.clientY).matrixTransform(frame.getScreenCTM().inverse());
  return [Math.floor(p.x),Math.floor(p.y)];
}
function placeTooltip(event) {
  if (!state.data || event.target.classList.contains("station")) return;
  const {w,h}=state.data.grid;
  const [x,y]=positionFromPointer(event);
  if (x<0 || y<0 || x>=w || y>=h) return hideTooltip();
  const i=y*w+x, id=state.zoneArray[i], z=state.elevation[i];
  const [lo,hi]=bandBounds[state.mapBand];
  if (id<1 || z<lo || z>=hi) return hideTooltip();
  const metric=state.mapMetric, layer=layerFor(metric), raw=layer.values[i], peak=peakText(metric,layer.peaks?.[i]);
  const area=(state.comune && state.comuneById[state.comuneArray[i]]) || state.zoneById[id];
  tooltip(event.clientX,event.clientY,area.name,
    [Number.isFinite(raw) ? value(raw,metric) : "Stima non disponibile",fmt(z)+" m",peak].filter(Boolean).join(" · "));
}
function drawBase() {
  const d=state.data, {w,h}=d.grid;
  frame.replaceChildren();
  state.raster = svg("image",{x:0,y:0,width:w,height:h,"aria-hidden":"true","pointer-events":"none"});
  state.shapes=svg("g",{"aria-hidden":"true"});
  state.names=svg("g",{"aria-hidden":"true"});
  state.stationLayer=svg("g",{"aria-label":"Stazioni con misure nell’ultimo giorno"});
  frame.append(state.raster,state.shapes,state.names,state.stationLayer);

  let minX=w,minY=h,maxX=0,maxY=0;
  for (let i=0;i<state.elevation.length;i++) if (state.elevation[i]!==-32768) {
    const x=i%w,y=Math.floor(i/w);
    minX=Math.min(minX,x); minY=Math.min(minY,y); maxX=Math.max(maxX,x); maxY=Math.max(maxY,y);
  }
  state.bounds=[minX-7,minY-7,maxX-minX+15,maxY-minY+15];
  for (const z of d.zones) {
    const path=svg("path",{d:zonePath(z.geometry),class:"zone-shape","data-zone":z.id,"fill-rule":"evenodd"});
    path.addEventListener("click",event => {
      if (state.comune) {
        const [x,y]=positionFromPointer(event);
        if (x<0 || y<0 || x>=w || y>=h) return;
        const id=state.comuneArray[y*w+x];
        if (id>0) chooseArea(z.id,id);
      } else chooseArea(z.id,0);
    });
    state.shapes.append(path);
  }
  state.selection=svg("path",{class:"zone-shape selected","fill-rule":"evenodd"});
  state.shapes.append(state.selection);
  for (const [name,lon,lat] of cities) {
    const [x,y]=project(lon,lat);
    state.names.append(svg("circle",{cx:x,cy:y,r:.75,fill:"#263e35",stroke:"#fff","stroke-width":.25,"pointer-events":"none"}));
    const label=svg("text",{x:x+1.6,y:y+.95,class:"place-label",
      style:"font-size:3.2px;stroke-width:0.7px"});
    label.textContent=name;
    state.names.append(label);
  }
  for (const s of d.stations) {
    const [x,y]=project(s.lon,s.lat);
    const circle=svg("circle",{cx:x,cy:y,r:1.05,class:"station",style:"stroke-width:.33px",tabindex:0,
      "aria-label":s.name});
    const description=["Misure di stazione · "+day(d.latest)+" · 00–24 (UTC+1, dati anche provvisori)",
      ...[["min","Minima","mean"],["mean","Media","mean"],["max","Massima","mean"],["rain","Pioggia","rain"]]
        .filter(([k])=>s[k]!=null).map(([k,label,metric])=>label+" "+value(s[k],metric))].join(" · ");
    circle.dataset.elevation=s.z;
    circle.setAttribute("aria-label",s.name+" · "+description);
    const show = e => {
      let x=e.clientX,y=e.clientY;
      if (x==null) { const r=circle.getBoundingClientRect(); x=r.left; y=r.top; }
      tooltip(x,y,s.name+" · "+fmt(s.z)+" m",description);
    };
    circle.addEventListener("pointerenter",show);
    circle.addEventListener("focus",show);
    circle.addEventListener("click",show);
    circle.addEventListener("blur",hideTooltip);
    circle.addEventListener("pointerleave",hideTooltip);
    state.stationLayer.append(circle);
  }
  toggleStations();
  updateZoom();
}
function drawSelection() {
  state.selection.setAttribute("d",zonePath(selectedArea().geometry));
}
function toggleStations() {
  if (!state.stationLayer) return;
  state.stationLayer.style.display=$("show-stations").checked ? "" : "none";
  const [lo,hi]=bandBounds[state.mapBand];
  for (const dot of state.stationLayer.children) dot.style.display=dot.dataset.elevation>=lo && dot.dataset.elevation<hi ? "" : "none";
}
function updateZoom() {
  if (!state.data) return;
  const [x,y,w,h]=state.bounds, z=state.zoom;
  const [cx,cy]=z===1 ? [x+w/2,y+h/2] : project(...selectedArea().center);
  const width=w/z,height=h/z;
  const clamp=(v,min,max)=>Math.min(Math.max(v,min),max);
  frame.setAttribute("viewBox",[clamp(cx-width/2,x,x+w-width),clamp(cy-height/2,y,y+h-height),width,height].join(" "));
  $("zoom-in").disabled=z>=3;
  $("zoom-out").disabled=z<=1;
  hideTooltip();
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
  const at=(i, fallback) => z[i]!==undefined && z[i]!==-32768 ? z[i] : fallback;
  for (let i=0;i<z.length;i++) {
    if (z[i]===-32768 || state.zoneArray[i]<=0) continue;
    const iy=Math.floor(i/w), ix=i%w, val=values[i], outside=z[i]<bandLo || z[i]>=bandHi;
    const slope=at(i+1,z[i])-at(i-1,z[i])+at(i+w,z[i])-at(i-w,z[i]);
    const shade=outside || !Number.isFinite(val) ? Math.max(-12,Math.min(12,slope*.045)) : 0;
    const rgb=outside ? [214,224,209] : !Number.isFinite(val) ?
      ((ix+iy)%5<2 ? [175,188,175] : [224,231,218]) : gradient(colors,low,high,val);
    for (let j=0;j<3;j++) img.data[4*i+j]=rgb[j]+(outside ? shade*.3 : shade);
    img.data[4*i+3]=255;
  }
  ctx.putImageData(img,0,0);
  state.raster.setAttribute("href",canvas.toDataURL());
}
function legend() {
  const m=metrics[state.mapMetric], [lo,hi]=metricRange(state.mapMetric);
  const labels=el("div",null,"legend-text");
  labels.append(el("span",m.unit==="gg" ? "GIORNI STIMATI" : "VALORI STIMATI"),el("span","Nessuna stima","no-data"));
  const ramp=el("div",null,"legend-ramp");
  ramp.style.background="linear-gradient(90deg,"+m.stops.join(",")+")";
  const scale=el("div",null,"legend-scale");
  scale.append(el("span",value(lo,state.mapMetric)),el("span",value((lo+hi)/2,state.mapMetric)),el("span",
    (m.unit==="gg" ? "" : "≥ ")+value(hi,state.mapMetric)));
  $("legend").replaceChildren(labels,ramp,scale);
}
function areaReading(id, band, key, grid=state.zoneArray) {
  const {values,peaks}=layerFor(key);
  return areaStats(values,grid,state.elevation,id,bandBounds[band],peaks);
}
function selectedReading() {
  return areaReading(selectedArea().id,state.mapBand,state.mapMetric,state.comune ? state.comuneArray : state.zoneArray);
}
function readZone() {
  const key=state.mapMetric, {cells,stats}=selectedReading();
  const box=$("zone-read");
  $("area-name").textContent=selectedArea().name;
  $("csv").disabled=!stats;
  if (!stats) {
    box.replaceChildren(el("p",cells ? "Nessuna stima per questa fascia e questo periodo." :
      "Non ci sono celle nella fascia di quota selezionata.","stat-meta"));
    return;
  }
  box.replaceChildren(el("div","Media delle celle con stima","stat-tag"),el("div",value(stats.mean,key),"stat-big"),
    el("div","Da "+fmt(stats.min)+" a "+value(stats.max,key)+" · Celle con stima: "+pct(stats.coverage),"stat-meta"));
  const peak=peakText(key,stats.peak);
  if (peak) box.append(el("p","Picco locale: "+value(stats.max,key)+" · "+peak,"stat-meta"));
}
function chooseArea(zone,comune) {
  state.zone=zone;
  state.comune=comune;
  if (comune) state.zoom=Math.max(2.65,state.zoom);
  $("map-zone").value=zone;
  $("comune-search").value=comune ? selectedArea().name : "";
  $("comune-results").replaceChildren();
  drawSelection(); readZone(); updateZoom(); syncUrl();
}
function renderDates() {
  const key=activeView()==="valli" ? state.compareMetric : state.mapMetric;
  const fixed=key==="gdd" || key==="spring";
  const [from,to]=boundsFor(key), seasonal=fixed || (key==="heat" && !state.dates);
  for (const id of ["date-start","date-end"]) {
    $(id).min=state.data.daily.start;
    $(id).max=state.data.latest;
    $(id).disabled=fixed;
  }
  $("date-start").value=seasonal ? "" : from;
  $("date-end").value=seasonal ? "" : to;
  $("date-reset").disabled=!state.dates || fixed;
  $("date-controls").querySelector('[type="submit"]').disabled=fixed;
  const span=peakDays[key];
  $("date-hint").textContent=fixed ? "Questo indicatore usa un periodo stagionale fisso." :
    span && dayIndex(to,from)+1<span ? "Seleziona almeno "+span+" giorni per questo indicatore." :
    seasonal ? "Periodo predefinito: l’estate in corso o l’ultima conclusa. Puoi scegliere date negli ultimi 90 giorni." :
    "Puoi scegliere date negli ultimi 90 giorni.";
}
function renderMap() {
  pressed($("metrics"),state.mapMetric);
  if (!state.data) return;
  const key=state.mapMetric, m=metrics[key];
  $("map-band").value=state.mapBand;
  $("map-zone").value=state.zone;
  $("comune-search").value=state.comune ? selectedArea().name : "";
  $("metric-title").textContent=m.title;
  $("metric-copy").textContent=m.copy;
  $("metric-tip").textContent=m.tip;
  $("period").textContent=period(key);
  drawSelection(); renderRaster(); legend(); readZone(); renderDates(); toggleStations(); hideTooltip(); syncUrl();
}
function compare() {
  const key=state.compareMetric, band=state.compareBand, m=metrics[key];
  pressed($("compare-metrics"),key);
  if (!state.data) return;
  $("compare-band").value=band;
  $("compare-period").textContent=period(key);
  $("sort-label").textContent=m.reverse ? "Media ↑" : "Media ↓";
  const score=s=>s?.coverage>=.6 ? 2 : s ? 1 : 0;
  const zones=state.data.zones.map(z=>[z,areaReading(z.id,band,key)]).map(([z,r])=>[z,r.stats,r.cells]).sort(([a,s],[b,t]) =>
    score(t)-score(s) || (m.reverse ? 1 : -1)*((s?.mean??0)-(t?.mean??0)) || a.name.localeCompare(b.name,"it"));
  const [first,top]=zones[0];
  const leaders=zones.filter(([,s])=>score(s)===2 && fmt(s.mean)===fmt(top?.mean));
  if (leaders.length>1) {
    const allZero=leaders.every(([,s])=>s.max===0);
    $("leader-title").textContent=allZero ? "Nessun evento stimato" : "Medie a pari merito";
    $("leader-text").textContent=(allZero ? "Valori a zero nelle aree in testa. " :
      leaders.length+" territori hanno la stessa media alla precisione mostrata. ")+"Le celle non stimabili restano escluse.";
  } else if (score(top)===2) {
    $("leader-title").textContent=first.name;
    $("leader-text").textContent=(m.reverse ? "Media più bassa" : "Media più alta")+" nella fascia selezionata: "+value(top.mean,key)+
      " ("+pct(top.coverage)+" di copertura). Il confronto include solo i territori con almeno il 60% di copertura.";
  } else {
    $("leader-title").textContent="Dati limitati";
    $("leader-text").textContent="Nessun territorio raggiunge il 60% di copertura per questo confronto.";
  }
  $("caveat-title").textContent=key==="gdd" ? "Calore non significa resa." :
    key==="rain" || peakDays[key] ? "Stime di pioggia, non allerte." : "Stessa fascia, quote diverse.";
  $("caveat-text").textContent=(key==="gdd" ? "Una stagione non misura il clima né la resa: contano acqua, suolo e varietà. " :
    key==="rain" ? "Senza una serie storica non sappiamo se l’accumulo è anomalo. " :
    peakDays[key] ? "Ogni cella può avere un picco in un giorno diverso. " : "")+
    "La copertura non misura l’accuratezza; le quote possono avere distribuzioni diverse anche nella stessa fascia.";
  const body=$("compare-rows");
  body.replaceChildren();
  for (const [z,s,cells] of zones) {
    const tr=el("tr"), title=el("th",z.name), mean=el("td",s ? value(s.mean,key) : "—","bar-cell");
    title.scope="row";
    if (s) {
      const [lo,hi]=metricRange(key), bar=el("span",null,"bar"), inside=el("span");
      inside.style.width=Math.max(0,Math.min(100,100*(s.mean-lo)/(hi-lo)))+"%";
      bar.setAttribute("aria-hidden","true"); bar.append(inside); mean.append(bar);
    }
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
  const elevations=rows.map(([z,s])=>z.name+": "+(s ?
    fmt(s.zMean)+" m di quota media ("+fmt(s.zMin)+"–"+fmt(s.zMax)+" m, "+s.count+" celle)" : "nessuna cella stimata"));
  $("pair-elevation").textContent=same ? "" : "Quote delle celle con stima — "+elevations.join("; ")+".";
  $("pair-copy").disabled=same; $("pair-csv").disabled=same;
  $("pair-status").textContent="";
}
function showRoute() {
  const which=activeView();
  $("date-controls").hidden=which==="metodo" || !state.data;
  for (const key of Object.keys(nav)) {
    $(key).hidden=key!==which;
    if (key===which) $("link-"+key).setAttribute("aria-current","page");
    else $("link-"+key).removeAttribute("aria-current");
  }
  $("page-title").textContent=nav[which][0];
  $("intro").textContent=nav[which][1];
  hideTooltip();
  toggleStations(); updateZoom();
  if (which==="mappa") renderMap();
  if (which==="valli") compare();
  if (which==="metodo") syncUrl();
}
async function populate(d) {
  const size=d.grid.w*d.grid.h;
  const byteLength=2*size*(dayIndex(d.latest,d.daily.start)+1);
  state.daily=Object.fromEntries(await Promise.all(Object.entries(d.daily.fields).map(async ([k,encoded])=>{
    const bytes=Uint8Array.from(atob(encoded),ch=>ch.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const buffer=await new Response(stream).arrayBuffer();
    if (buffer.byteLength!==byteLength) throw new Error("Serie giornaliera di dimensione inattesa");
    return [k,new Int16Array(buffer)];
  })));
  state.data=d;
  state.layers.clear();
  state.elevation=decode(d.elevation);
  state.zoneArray=decode(d.zoneGrid);
  state.comuneArray=decode(d.comuneGrid);
  state.zoneById=Object.fromEntries(d.zones.map(z=>[z.id,z]));
  state.comuneById=Object.fromEntries(d.comuni.map(z=>[z.id,z]));
  restoreUrl();
  $("map-zone").replaceChildren();
  for (const id of ["map-zone","pair-a","pair-b"]) {
    $(id).replaceChildren();
    for (const z of [...d.zones].sort((a,b)=>a.name.localeCompare(b.name,"it"))) option($(id),z.id,z.name);
  }
  d.comuni.sort((a,b)=>a.name.localeCompare(b.name,"it"));
  $("latest").textContent=day(d.latest);
  const stale=Date.now()-Date.parse(d.latest)>3*86400000;
  $("source-status").textContent=stale ? "DATI NON RECENTI" : "ULTIMO GIORNO OSSERVATO";
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
  drawBase(); showRoute();
}
async function load() {
  $("error").hidden=true;
  $("source-status").textContent="CARICAMENTO DATI";
  try {
    const response=await fetch("data/atlas.json",{cache:"no-cache"});
    if (!response.ok) throw new Error("Dati non disponibili");
    const d=await response.json();
    if (d.schema!==2) throw new Error("Formato dati non supportato");
    await populate(d);
  } catch (err) {
    console.error(err);
    $("error").hidden=false;
    $("source-status").textContent="DATI NON DISPONIBILI";
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
function openComune(area) {
  const {w,h}=state.data.grid;
  const counts=new Map();
  for (let i=0;i<w*h;i++) if (state.comuneArray[i]===area.id && state.zoneArray[i]>0) {
    const z=state.zoneArray[i];
    counts.set(z,(counts.get(z)??0)+1);
  }
  const zone=[...counts].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? state.zone;
  chooseArea(zone,area.id);
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
  ctx.fillText("Aree tratteggiate: stima non disponibile",468,876);
  ctx.fillText("Dati: Meteotrentino, CC BY 4.0 · Rilievo: TINITALY, INGV · Confini: Provincia autonoma di Trento · Stime, non allerte.",32,924);
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
  $("date-status").textContent="";
  if (activeView()==="valli") compare(); else renderMap();
}

createMetricControls($("metrics"),"mapMetric",renderMap);
createMetricControls($("compare-metrics"),"compareMetric",compare);
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
    button.addEventListener("click",()=>{openComune(area);$("comune-search").focus();});
    const li=el("li"); li.append(button); results.append(li);
  }
  if ($("comune-search").value.trim() && !matches.length) results.append(el("li","Nessun comune trovato."));
});
$("comune-form").addEventListener("submit",event=>{
  event.preventDefault();
  const [area]=comuneMatches();
  if (area) openComune(area);
});
$("date-controls").addEventListener("submit",event=>{
  event.preventDefault();
  const a=$("date-start").value,b=$("date-end").value;
  if (a>b) { $("date-status").textContent="La data iniziale deve precedere o coincidere con quella finale."; return; }
  state.dates=[a,b]; applyDateView();
});
$("date-reset").addEventListener("click",()=>{state.dates=null;applyDateView();});
$("show-stations").addEventListener("change",()=>{toggleStations();syncUrl();});
function zoomTo(z) { state.zoom=Math.min(3,Math.max(1,z)); updateZoom(); syncUrl(); }
$("zoom-in").addEventListener("click",()=>zoomTo(state.zoom+.55));
$("zoom-out").addEventListener("click",()=>zoomTo(state.zoom-.55));
$("zoom-reset").addEventListener("click",()=>zoomTo(1));
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
  state.mapMetric,state.mapBand,state.comune ? "Comune" : "Comunità di valle");});
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
$("print").addEventListener("click",()=>{if (state.data) window.print();});
$("retry").addEventListener("click",load);
document.querySelector(".skip").addEventListener("click",event=>{
  event.preventDefault();
  $("contenuto").focus();
  $("contenuto").scrollIntoView();
});
frame.addEventListener("pointermove",placeTooltip);
frame.addEventListener("pointerleave",hideTooltip);
window.addEventListener("hashchange",()=>{
  if (state.data) restoreUrl(); showRoute(); window.scrollTo(0,0);
});
showRoute();
load();
