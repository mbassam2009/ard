import json, math
from pyproj import Transformer, Geod
pts_utm = [(639519.578,2732727.432),(639739.284,2732693.764),(639648.987,2732526.558),(639478.878,2732580.677),(639462.772,2732654.05)]
pts_ll_deed = [(24.7026707,46.3792298),(24.7023468,46.3813979),(24.7008453,46.3804888),(24.7013494,46.378813),(24.7020133,46.3786611)]
t = Transformer.from_crs("EPSG:32638","EPSG:4326",always_xy=True)
tinv = Transformer.from_crs("EPSG:4326","EPSG:32638",always_xy=True)
geod = Geod(ellps="WGS84")
n=len(pts_utm)
A=0
for i in range(n):
    x1,y1=pts_utm[i]; x2,y2=pts_utm[(i+1)%n]; A+=x1*y2-x2*y1
A=abs(A)/2
print("UTM shoelace area", round(A,2))
sides=[]
for i in range(n):
    x1,y1=pts_utm[i]; x2,y2=pts_utm[(i+1)%n]
    d=math.hypot(x2-x1,y2-y1); brg=(math.degrees(math.atan2(x2-x1,y2-y1))+360)%360
    sides.append((i+1,(i+1)%n+1,round(d,2),round(brg,2)))
print("sides",sides)
ll=[t.transform(x,y) for x,y in pts_utm]
for i,(lon,lat) in enumerate(ll):
    dl=pts_ll_deed[i]
    _,_,dist=geod.inv(lon,lat,dl[1],dl[0])
    print(i+1, round(lat,7), round(lon,7), "deed", dl, "diff m", round(dist,3))
lons=[p[0] for p in ll]; lats=[p[1] for p in ll]
garea,gper=geod.polygon_area_perimeter(lons,lats)
print("geodesic area", round(abs(garea),2), "perimeter", round(gper,2))
# interior angles
ang=[]
for i in range(n):
    p0=pts_utm[i-1]; p1=pts_utm[i]; p2=pts_utm[(i+1)%n]
    a1=math.atan2(p0[1]-p1[1],p0[0]-p1[0]); a2=math.atan2(p2[1]-p1[1],p2[0]-p1[0])
    d=math.degrees(a1-a2)%360
    ang.append(d)
print("angles", [round(a,2) for a in ang], sum(ang))
# grid convergence / scale factor
import pyproj
p=pyproj.Proj("EPSG:32638")
cx=sum(lons)/n; cy=sum(lats)/n
f=p.get_factors(cx,cy)
print("scale factor", f.meridional_scale, "convergence", f.meridian_convergence)
from shapely.geometry import Polygon
poly=Polygon(pts_utm)
c=poly.centroid; clon,clat=t.transform(c.x,c.y)
print("centroid", clat, clon)
mrr=poly.minimum_rotated_rectangle
print("perimeter", poly.length, "compactness", 4*math.pi*A/poly.length**2, "mrr area", mrr.area)
