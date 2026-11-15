"""Planting suitability per 10 m pixel + bundle water/soil/imagery data into data_water.js."""
import json, math
import numpy as np
D='data/'
ter=json.load(open(D+'terrain.json'))['grid']
Z=np.array([[float(v) for v in r.split(',')] for r in ter['z'].split(';')])
lo0,la0=ter['origin']; mx=1/(111320*math.cos(math.radians(24.7018))); my=1/110780
def zat(lo,la):
    fi=(lo-lo0)/mx/30; fj=(la0-la)/my/30; i,j=int(fi),int(fj); a,b=fi-i,fj-j
    return Z[j,i]*(1-a)*(1-b)+Z[j,i+1]*a*(1-b)+Z[j+1,i]*(1-a)*b+Z[j+1,i+1]*a*b
lines=[l for l in open(D+'plot_pixels.txt') if not l.startswith('#')]
x0,y1,dx,dy=46.37,24.71,0.00009442060085839301,0.00009467455621302835
px=[]
for r in ''.join(lines).strip().split(';'):
    i,j,g,br,sr=map(int,r.split(','))
    lo=x0+(i+0.5)*dx; la=y1-(j+0.5)*dy
    d=15.0
    gx=(zat(lo+d*mx,la)-zat(lo-d*mx,la))/(2*d); gy=(zat(lo,la+d*my)-zat(lo,la-d*my))/(2*d)
    slope=math.degrees(math.atan(math.hypot(gx,gy)))
    gs=min(1,max(0,(g/1000+0.01)/0.06))
    soil=0.6*min(1,max(0,(350-br)/200))+0.4*min(1,max(0,(sr-113)/7))
    ss=1 if slope<5 else 0.75 if slope<10 else 0.45 if slope<15 else 0.2 if slope<20 else 0
    score=0.4*gs+0.3*soil+0.3*ss
    px.append(dict(i=i,j=j,lo=round(lo,6),la=round(la,6),g=g,br=br,sr=sr,slope=round(slope,1),score=round(score,3)))
A=dx*111320*math.cos(math.radians(24.7018))*dy*110780
cls={'good':sum(p['score']>=0.6 for p in px),'fair':sum(0.4<=p['score']<0.6 for p in px),'poor':sum(p['score']<0.4 for p in px)}
print('pixel area',round(A,1),cls,{k:round(v*A) for k,v in cls.items()})
# correlations
g=np.array([p['g'] for p in px]);br=np.array([p['br'] for p in px]);sl=np.array([p['slope'] for p in px])
print('corr g-br',np.corrcoef(g,br)[0,1].round(2),'g-slope',np.corrcoef(g,sl)[0,1].round(2))
good=[p for p in px if p['score']>=0.6]
print('good centroid',np.mean([p['lo'] for p in good]).round(5),np.mean([p['la'] for p in good]).round(5),'mean slope good',np.mean([p['slope'] for p in good]).round(1))
w=json.load(open(D+'water.json'))
wayback=[["2024-09-15",43291,"WorldView-3",0.31,"Vantor (Maxar)"],["2020-10-03",51127,"WorldView-2",0.5,"Maxar"],["2020-03-10",47471,"WorldView-2",0.5,"Maxar"],["2019-09-30",42663,"WorldView-2",0.5,"Maxar"],["2019-03-10",119,"WorldView-3",0.31,"Maxar"],["2017-03-06",23001,"WorldView-2",0.5,"DigitalGlobe"],["2011-12-13",13045,"WorldView-2",0.5,"DigitalGlobe"],["2010-02-10",6984,"WorldView-2",0.5,"DigitalGlobe"]]
s1=[["2016-11-28","2016-11-16","2016-11-28",-1.39,-2.08],["2017-02-16","2017-02-08","2017-02-20",-0.72,-0.87],["2018-11-10","2018-10-25","2018-11-18",-1.77,-1.77],["2019-11-19","2019-11-01","2019-11-13",0.52,1.66],["2020-01-05","2019-12-31","2020-01-12",-1.26,-2.33],["2023-01-06","2022-12-27","2023-01-08",0.09,-0.31],["2024-05-01","2024-04-20","2024-05-02",-0.95,-1.04],["2025-02-15","2025-02-02","2025-02-14",-0.74,-1.07],["2025-12-15","2025-12-11","2025-12-23",-1.6,-1.64]]
out=dict(greenScene='S2A_MSIL2A_20230306T072751_R049_T38RPN_20230306T190456',water=w,pixels=dict(x0=x0,y1=y1,dx=dx,dy=dy,area=round(A,1),px=px,classes=cls),wayback=wayback,s1=s1)
open('data_water.js','w').write('window.ARDW='+json.dumps(out,separators=(',',':'))+';\n')
