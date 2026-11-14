// Ard data pipeline: the code that produced data/*.json and data/*.txt.
// The build machine could not reach these APIs directly, so each step ran in a
// browser tab (all of these services allow cross-origin requests). Paste into the
// devtools console on any https page, then call the steps one at a time.
// Results are small summaries; they were copied into the files under data/.

const LAT = 24.70183, LON = 46.37994;
const POLY = {type:"Polygon",coordinates:[[[46.3792299,24.7026708],[46.3813979,24.7023468],[46.3804889,24.7008453],[46.378813,24.7013494],[46.3786611,24.7020134],[46.3792299,24.7026708]]]};
const D2R = Math.PI/180, R2D = 180/Math.PI;

// ---------- 1. NASA POWER daily + FAO-56 reference ET  -> power_monthly.txt, power_annual.json
async function powerDaily() {
  const p = "T2M_MAX,T2M_MIN,T2M,RH2M,WS2M,ALLSKY_SFC_SW_DWN,CLRSKY_SFC_SW_DWN,PRECTOTCORR,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,PS,T2MDEW";
  const j = await (await fetch(`https://power.larc.nasa.gov/api/temporal/daily/point?parameters=${p}&community=AG&longitude=${LON}&latitude=${LAT}&start=20010101&end=20251231&format=JSON`)).json();
  const P = j.properties.parameter, days = Object.keys(P.T2M);
  const phi = LAT*D2R;
  const et0 = (d) => { // FAO-56 eq. 6, daily, G = 0
    const date = new Date(Date.UTC(+d.slice(0,4), +d.slice(4,6)-1, +d.slice(6,8)));
    const J = Math.round((date - Date.UTC(date.getUTCFullYear(),0,0))/864e5);
    const Tx=P.T2M_MAX[d], Tn=P.T2M_MIN[d], T=(Tx+Tn)/2, g=0.000665*P.PS[d];
    const es=(0.6108*Math.exp(17.27*Tx/(Tx+237.3))+0.6108*Math.exp(17.27*Tn/(Tn+237.3)))/2;
    const ea=0.6108*Math.exp(17.27*P.T2MDEW[d]/(P.T2MDEW[d]+237.3));
    const D=4098*0.6108*Math.exp(17.27*T/(T+237.3))/(T+237.3)**2;
    const dr=1+0.033*Math.cos(2*Math.PI*J/365), dl=0.409*Math.sin(2*Math.PI*J/365-1.39), ws=Math.acos(-Math.tan(phi)*Math.tan(dl));
    const Ra=24*60/Math.PI*0.082*dr*(ws*Math.sin(phi)*Math.sin(dl)+Math.cos(phi)*Math.cos(dl)*Math.sin(ws));
    const Rso=(0.75+2e-5*650)*Ra, Rs=Math.min(P.ALLSKY_SFC_SW_DWN[d],Rso);
    const Rnl=4.903e-9*(((Tx+273.16)**4+(Tn+273.16)**4)/2)*(0.34-0.14*Math.sqrt(ea))*(1.35*Rs/Rso-0.35);
    const Rn=0.77*Rs-Rnl, u2=P.WS2M[d];
    return (0.408*D*Rn+g*900/(T+273)*u2*(es-ea))/(D+g*(1+0.34*u2));
  };
  return days.map(d => ({d, et0: et0(d), ...Object.fromEntries(Object.keys(P).map(k=>[k,P[k][d]]))}));
  // Monthly: means of T2M/T2M_MAX/T2M_MIN/RH2M/WS2M/ALLSKY_SFC_SW_DWN/ALLSKY_SFC_SW_DNI, sums of PRECTOTCORR and et0.
  // Annual: max Tmax, min Tmin, days >= 45 / >= 40 C, rain total, max daily rain, rain days >= 1 mm, ET0 sum, GHI sum / 3.6, frost nights.
}

// ---------- 2. Solar sun position (NOAA) used by the PV model and the site
function sunpos(ms, lat=LAT, lon=LON) {
  const jd=ms/864e5+2440587.5, T=(jd-2451545)/36525;
  const L0=(280.46646+T*(36000.76983+T*0.0003032))%360, M=357.52911+T*(35999.05029-0.0001537*T), e=0.016708634-T*(0.000042037+0.0000001267*T);
  const C=Math.sin(M*D2R)*(1.914602-T*(0.004817+0.000014*T))+Math.sin(2*M*D2R)*(0.019993-0.000101*T)+Math.sin(3*M*D2R)*0.000289;
  const om=125.04-1934.136*T, lam=L0+C-0.00569-0.00478*Math.sin(om*D2R);
  const eps=23+(26+(21.448-T*(46.815+T*(0.00059-T*0.001813)))/60)/60+0.00256*Math.cos(om*D2R);
  const dec=Math.asin(Math.sin(eps*D2R)*Math.sin(lam*D2R)), y=Math.tan(eps*D2R/2)**2;
  const Et=4*R2D*(y*Math.sin(2*L0*D2R)-2*e*Math.sin(M*D2R)+4*e*y*Math.sin(M*D2R)*Math.cos(2*L0*D2R)-0.5*y*y*Math.sin(4*L0*D2R)-1.25*e*e*Math.sin(2*M*D2R));
  const d=new Date(ms), mins=d.getUTCHours()*60+d.getUTCMinutes();
  const tst=((mins+Et+4*lon)%1440+1440)%1440, ha=tst/4<0?tst/4+180:tst/4-180;
  const z=Math.acos(Math.max(-1,Math.min(1,Math.sin(lat*D2R)*Math.sin(dec)+Math.cos(lat*D2R)*Math.cos(dec)*Math.cos(ha*D2R))));
  let az=Math.acos(Math.max(-1,Math.min(1,(Math.sin(lat*D2R)*Math.cos(z)-Math.sin(dec))/(Math.cos(lat*D2R)*Math.sin(z)))))*R2D;
  az = ha>0 ? (az+180)%360 : (540-az)%360;
  return {z, az: az*D2R};
}

// ---------- 3. PV model on POWER hourly 2020-2024 -> pv.json
async function pv() {
  const j = await (await fetch(`https://power.larc.nasa.gov/api/temporal/hourly/point?parameters=ALLSKY_SFC_SW_DWN,ALLSKY_SFC_SW_DNI,ALLSKY_SFC_SW_DIFF,T2M,WS10M&community=RE&longitude=${LON}&latitude=${LAT}&start=20200101&end=20241231&format=JSON&time-standard=UTC`)).json();
  const p = j.properties.parameter;
  const iam = c => c<=0 ? 0 : Math.max(0, 1-0.05*(1/c-1));                     // ASHRAE, b0 = 0.05
  const dc = (poa, ta, ws) => { if (poa<=0) return 0; const tm=poa*Math.exp(-3.56-0.075*ws)+ta, tc=tm+poa/1000*3; return poa/1000*(1-0.0037*(tc-25)); }; // SAPM open rack
  const loss = 0.86*0.96, albedo = 0.3;
  const out = {};
  for (const k of Object.keys(p.T2M)) {
    const ghi=p.ALLSKY_SFC_SW_DWN[k], dni=p.ALLSKY_SFC_SW_DNI[k], dhi=p.ALLSKY_SFC_SW_DIFF[k];
    if (ghi<=0 || dni<0) continue;
    const {z, az} = sunpos(Date.UTC(+k.slice(0,4), +k.slice(4,6)-1, +k.slice(6,8), +k.slice(8,10), 30)); // hour-centre
    if (z >= Math.PI/2-0.01) continue;
    const sz=Math.sin(z), cz=Math.cos(z), ym=k.slice(0,6);
    for (const b of [0,5,10,15,20,25,30,35,40,50]) {                           // fixed, facing south
      const sb=Math.sin(b*D2R), cb=Math.cos(b*D2R), ci=-sz*Math.cos(az)*sb+cz*cb;
      const v = dc(Math.max(0,dni*ci)*iam(ci) + dhi*(1+cb)/2*0.95 + ghi*albedo*(1-cb)/2, p.T2M[k], p.WS10M[k])*loss;
      out['fix'+b] = out['fix'+b] || {}; out['fix'+b][ym] = (out['fix'+b][ym]||0) + v;
    }
    let R = Math.atan2(sz*Math.sin(az), cz); R = Math.max(-60*D2R, Math.min(60*D2R, R)); // N-S horizontal tracker
    const ci = sz*Math.sin(az)*Math.sin(R)+cz*Math.cos(R), cb = Math.cos(R);
    const v = dc(Math.max(0,dni*ci)*iam(ci) + dhi*(1+cb)/2*0.95 + ghi*albedo*(1-cb)/2, p.T2M[k], p.WS10M[k])*loss;
    out.trk = out.trk || {}; out.trk[ym] = (out.trk[ym]||0) + v;
  }
  return out; // kWh per kWp per month
}

// ---------- 4. Sentinel-2 band means over the plot -> s2_plot.txt
async function sentinel2() {
  let items=[], url="https://planetarycomputer.microsoft.com/api/stac/v1/search";
  let opts={method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({collections:["sentinel-2-l2a"],intersects:POLY,datetime:"2015-06-01/2026-11-15",query:{"eo:cloud_cover":{lt:15}},limit:1000})};
  while (url) { const j = await (await fetch(url,opts)).json(); items.push(...j.features);
    const nx=(j.links||[]).find(l=>l.rel==="next"); if (nx) { url=nx.href; opts={method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(nx.body)}; } else url=null; }
  const best = {}; for (const f of items) { const m=f.properties.datetime.slice(0,7); if (!best[m] || f.properties["eo:cloud_cover"]<best[m].properties["eo:cloud_cover"]) best[m]=f; }
  const rows = [];
  for (const f of Object.values(best)) {
    const u=`https://planetarycomputer.microsoft.com/api/data/v1/item/statistics?collection=sentinel-2-l2a&item=${f.id}&assets=B02&assets=B03&assets=B04&assets=B08&assets=B11&assets=B12`;
    const s=(await (await fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"Feature",properties:{},geometry:POLY})})).json()).properties.statistics;
    const off = f.properties.datetime >= "2022-01-25" ? 1000 : 0;  // processing baseline 04.00 offset
    const g = b => (s[b+"_b1"].mean-off)/10000;
    rows.push([f.properties.datetime.slice(0,10), g("B02"), g("B03"), g("B04"), g("B08"), g("B11"), g("B12"), s.B04_b1.std/10000]);
  }
  return rows; // date, blue, green, red, nir, swir1, swir2, std(red)
}

// ---------- 5. Copernicus DEM: fill, D8, accumulation, HAND -> terrain.json, streams.txt
async function terrain() {
  const GT = await import("https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm");
  const f0 = (await (await fetch("https://planetarycomputer.microsoft.com/api/stac/v1/search",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({collections:["cop-dem-glo-30"],intersects:{type:"Point",coordinates:[46.38,24.70]}})})).json()).features[0];
  const tok = (await (await fetch("https://planetarycomputer.microsoft.com/api/sas/v1/token/cop-dem-glo-30")).json()).token;
  const img = await (await GT.fromUrl(f0.assets.data.href+"?"+tok)).getImage();
  const x0=Math.round(0.27*3600), x1=Math.round(0.47*3600), y0=Math.round(0.20*3600), y1=Math.round(0.40*3600); // 46.27-46.47 E, 24.60-24.80 N
  const z = Float32Array.from((await img.readRasters({window:[x0,y0,x1,y1],samples:[0]}))[0]);
  const w=x1-x0, h=y1-y0, N=w*h, dx=30.87*Math.cos(24.7*D2R), dy=30.87;
  // priority-flood with epsilon (Barnes et al. 2014), then D8 steepest descent, then accumulation in descending elevation order
  const f = Float32Array.from(z), done = new Uint8Array(N), heap = [];
  const push=i=>{heap.push(i);let k=heap.length-1;while(k>0){const p=(k-1)>>1;if(f[heap[p]]<=f[heap[k]])break;[heap[p],heap[k]]=[heap[k],heap[p]];k=p;}};
  const pop=()=>{const t=heap[0],l=heap.pop();if(heap.length){heap[0]=l;let k=0;for(;;){let c=2*k+1;if(c>=heap.length)break;if(c+1<heap.length&&f[heap[c+1]]<f[heap[c]])c++;if(f[heap[k]]<=f[heap[c]])break;[heap[k],heap[c]]=[heap[c],heap[k]];k=c;}}return t;};
  for(let i=0;i<w;i++)for(const j of[0,h-1]){const k=j*w+i;if(!done[k]){done[k]=1;push(k);}}
  for(let j=0;j<h;j++)for(const i of[0,w-1]){const k=j*w+i;if(!done[k]){done[k]=1;push(k);}}
  const di=[1,1,0,-1,-1,-1,0,1], dj=[0,1,1,1,0,-1,-1,-1], dd=[dx,Math.hypot(dx,dy),dy,Math.hypot(dx,dy),dx,Math.hypot(dx,dy),dy,Math.hypot(dx,dy)];
  while(heap.length){const k=pop(),i=k%w,j=(k-i)/w;for(let d=0;d<8;d++){const ii=i+di[d],jj=j+dj[d];if(ii<0||jj<0||ii>=w||jj>=h)continue;const kk=jj*w+ii;if(done[kk])continue;done[kk]=1;if(f[kk]<=f[k])f[kk]=f[k]+1e-4;push(kk);}}
  const dir=new Int8Array(N).fill(-1);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const k=j*w+i;let best=0;for(let d=0;d<8;d++){const ii=i+di[d],jj=j+dj[d];if(ii<0||jj<0||ii>=w||jj>=h)continue;const s=(f[k]-f[jj*w+ii])/dd[d];if(s>best){best=s;dir[k]=d;}}}
  const acc=new Float64Array(N).fill(1);
  for(const k of Array.from({length:N},(_,k)=>k).sort((a,b)=>f[b]-f[a])){const d=dir[k];if(d<0)continue;const i=k%w,j=(k-i)/w;acc[(j+dj[d])*w+i+di[d]]+=acc[k];}
  return {z, f, dir, acc, w, h, x0, y0, cellArea: dx*dy};
  // HAND: from each plot cell follow dir[] until acc*cellArea >= 0.5 km2; HAND = z(start) - z(channel).
  // Streams: cells with acc*cellArea >= 0.1 km2 inside a 3 x 3 km box, traced downstream from channel heads.
}

// ---------- 6. ERA5 (Open-Meteo), land cover (IO LULC), OpenStreetMap
const era5Url = `https://archive-api.open-meteo.com/v1/archive?latitude=${LAT}&longitude=${LON}&start_date=1950-01-01&end_date=2025-12-31&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_gusts_10m_max&timezone=Asia%2FRiyadh&models=era5`;
const lulcStats = (item, circle) => fetch(`https://planetarycomputer.microsoft.com/api/data/v1/item/statistics?collection=io-lulc-annual-v02&item=${item}&assets=data&categorical=true&c=1&c=2&c=4&c=5&c=7&c=8&c=9&c=10&c=11`,
  {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({type:"Feature",properties:{},geometry:circle})}).then(r=>r.json());
const overpassQuery = `[out:json][timeout:60];(way["highway"~"motorway|trunk|primary|secondary|tertiary|residential|unclassified"](around:3000,${LAT},${LON});way["building"](around:3000,${LAT},${LON});nwr["amenity"~"place_of_worship|school|hospital|clinic|fuel|pharmacy|university"](around:8000,${LAT},${LON});nwr["place"](around:12000,${LAT},${LON}););out tags center;`;
