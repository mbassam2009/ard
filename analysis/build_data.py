"""Bundle every dataset + derived numbers into site/data.js."""
import json, math
import numpy as np
from shapely.geometry import Polygon, Point
from pyproj import Transformer
D='data/'
utm=[(639519.578,2732727.432),(639739.284,2732693.764),(639648.987,2732526.558),(639478.878,2732580.677),(639462.772,2732654.05)]
ll=[(24.7026707,46.3792298),(24.7023468,46.3813979),(24.7008453,46.3804888),(24.7013494,46.378813),(24.7020133,46.3786611)]
poly_utm=Polygon(utm)
t=Transformer.from_crs("EPSG:4326","EPSG:32638",always_xy=True)

# --- geometry
sides=[]
for i in range(5):
    (x1,y1),(x2,y2)=utm[i],utm[(i+1)%5]
    sides.append(dict(a=i+1,b=(i+1)%5+1,len=round(math.hypot(x2-x1,y2-y1),2),brg=round((math.degrees(math.atan2(x2-x1,y2-y1))+360)%360,1)))
ang=[]
for i in range(5):
    p0,p1,p2=utm[i-1],utm[i],utm[(i+1)%5]
    a1=math.atan2(p0[1]-p1[1],p0[0]-p1[0]);a2=math.atan2(p2[1]-p1[1],p2[0]-p1[0])
    ang.append(round(360-(math.degrees(a1-a2)%360),2))
geom=dict(area_grid=round(poly_utm.area,1),area_ellipsoid=36158.1,area_deed=36049.9,perimeter=round(poly_utm.length,2),
          sides=sides,angles=ang,utm=utm,ll=ll,centroid=[24.701834,46.379940],
          deed_sides={"N":222.27,"S":178.51,"E":190.3,"W":167.92},
          west_computed=round(sides[3]['len']+sides[4]['len'],2),coord_check_max_cm=1.0,scale_factor=0.99984,convergence_deg=0.577)

# --- earthworks from 30 m DEM grid (cut/fill to a single level pad = balanced level)
ter=json.load(open(D+'terrain.json'))
g=ter['grid'];Z=np.array([[float(v) for v in r.split(',')] for r in g['z'].split(';')])
mx=1/(111320*math.cos(math.radians(24.7018)));my=1/110780
# finer: bilinear upsample to 5 m and keep cells inside the polygon
lo0,la0=g['origin'];step=5
xs=[];zs=[]
for jj in np.arange(0,(Z.shape[0]-1)*30,step):
    for ii in np.arange(0,(Z.shape[1]-1)*30,step):
        lo=lo0+ii*mx;la=la0-jj*my
        x,y=t.transform(lo,la)
        if not poly_utm.contains(Point(x,y)):continue
        fi,fj=ii/30,jj/30;i,j=int(fi),int(fj);a,b=fi-i,fj-j
        z=Z[j,i]*(1-a)*(1-b)+Z[j,i+1]*a*(1-b)+Z[j+1,i]*(1-a)*b+Z[j+1,i+1]*a*b
        zs.append(z)
zs=np.array(zs);A=poly_utm.area/len(zs)
lev=np.median(zs)  # balanced cut/fill level ~ median for equal areas; refine by search
best=None
for L in np.arange(zs.min(),zs.max(),0.1):
    cut=((zs-L).clip(min=0)).sum()*A;fill=((L-zs).clip(min=0)).sum()*A
    if best is None or abs(cut-fill)<abs(best[1]-best[2]):best=(L,cut,fill)
earth=dict(level=round(best[0],1),cut_m3=round(best[1],-2),fill_m3=round(best[2],-2),samples=len(zs),zmin=round(zs.min(),1),zmax=round(zs.max(),1),
           note="Balanced cut/fill to one flat level over the whole plot, from the 30 m Copernicus DEM resampled to 5 m. Order of magnitude only.")
print('earthworks',earth)

# --- climate
pm=[r.split(',') for r in open(D+'power_monthly.txt').read().strip().split(';')]
cols=['ym','t','tmax','tmin','rh','rain','ghi','et0','ws','dni']
monthly=[dict(zip(cols,[r[0]]+[float(v) for v in r[1:]])) for r in pm]
clim=[]
for m in range(1,13):
    rows=[r for r in monthly if int(r['ym'][4:])==m]
    clim.append({k:round(float(np.mean([r[k] for r in rows])),1) for k in cols[1:]})
ann=json.load(open(D+'power_annual.json'))
era=json.load(open(D+'era5.json'))
eray=[[float(v) for v in r.split(',')] for r in era['years'].split(';')]

# --- satellite
s2=[r.split(',') for r in open(D+'s2_plot.txt').read().strip().split(';')]
s2=[dict(d=r[0],b2=float(r[1]),b3=float(r[2]),b4=float(r[3]),b8=float(r[4]),b11=float(r[5]),b12=float(r[6]),sd=float(r[7])) for r in s2]
for r in s2:
    r['ndvi']=round((r['b8']-r['b4'])/(r['b8']+r['b4']),4)
    r['bright']=round((r['b2']+r['b3']+r['b4'])/3,4)
pv=json.load(open(D+'pv.json'))
ctx=json.load(open(D+'context.json'))
streams=[[[float(v) for v in p.split(' ')] for p in line.split('|')] for line in open(D+'streams.txt').read().strip().split(';')]

scenes={"landsat":{"1987":["LT05_L2SP_166043_19871025_02_T1","1987-10-25"],"1990":["LT05_L2SP_166043_19901017_02_T1","1990-10-17"],"1994":["LT05_L2SP_166043_19941012_02_T1","1994-10-12"],"1998":["LT05_L2SP_166043_19981023_02_T1","1998-10-23"],"2002":["LT05_L2SP_166043_20020730_02_T1","2002-07-30"],"2014":["LC08_L2SP_166043_20141019_02_T1","2014-10-19"]},
"s2":{"2016":["S2A_MSIL2A_20160710T072622_R049_T38RPN_20210212T030901","2016-07-10"],"2017":["S2A_MSIL2A_20170913T072611_R049_T38RPN_20210202T014152","2017-09-13"],"2018":["S2A_MSIL2A_20180511T072621_R049_T38RPN_20201012T082634","2018-05-11"],"2019":["S2B_MSIL2A_20191008T072759_R049_T38RPN_20201004T000501","2019-10-08"],"2020":["S2A_MSIL2A_20200331T072611_R049_T38RPN_20201022T150641","2020-03-31"],"2021":["S2B_MSIL2A_20210321T072619_R049_T38RPN_20210322T095301","2021-03-21"],"2022":["S2B_MSIL2A_20220316T072639_R049_T38RPN_20220316T192951","2022-03-16"],"2023":["S2B_MSIL2A_20231017T072909_R049_T38RPN_20241103T131650","2023-10-17"],"2024":["S2A_MSIL2A_20241016T072901_R049_T38RPN_20241016T104047","2024-10-16"],"2025":["S2B_MSIL2A_20250718T072619_R049_T38RPN_20250718T094203","2025-07-18"],"2026":["S2B_MSIL2A_20260524T072609_R049_T38RPN_20260524T094231","2026-05-24"]}}

summary=dict(et0_mean=round(np.mean([a['et0'] for a in ann[-11:]])),rain_mean_power=round(np.mean([a['rain'] for a in ann]),1),
  rain_mean_era_1996=round(float(np.mean([r[4] for r in eray if r[0]>=1996])),1),
  t_1950_79=round(float(np.mean([r[1] for r in eray if r[0]<1980])),2),t_1996_2025=round(float(np.mean([r[1] for r in eray if r[0]>=1996])),2),
  trend_per_decade=round(float(np.polyfit([r[0] for r in eray],[r[1] for r in eray],1)[0]*10),2),
  ghi_mean=round(np.mean([a['ghi'] for a in ann[-10:]])),ndvi_mean=round(float(np.mean([r['ndvi'] for r in s2])),3),ndvi_max=round(max(r['ndvi'] for r in s2),3))
print(summary)
out=dict(geom=geom,earth=earth,clim=clim,monthly=monthly,annual=ann,era=dict(cols=era['cols'],years=eray,top=era['top_rain_days']),
         s2=s2,pv=pv,terrain=ter,streams=streams,ctx=ctx,scenes=scenes,summary=summary)
open('site/data.js','w').write('window.ARD='+json.dumps(out,separators=(',',':'))+';\n')
import os;print('data.js',os.path.getsize('site/data.js'))
