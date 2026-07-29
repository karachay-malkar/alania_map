#!/usr/bin/env python3
from pathlib import Path
import json
from PIL import Image, ImageDraw

INK=(14,35,69,255)
HATCH=(14,35,69,155)
CATALOG={'version': '8.0', 'pixel_ratio': 4, 'mountains': [{'id': 'mount-1', 'file': 'mount-1.png', 'width_px': 201, 'height_px': 139, 'profiles': ['rocky', 'massif'], 'nominal_width_km': 7.5}, {'id': 'mount-2', 'file': 'mount-2.png', 'width_px': 323, 'height_px': 99, 'profiles': ['ridge', 'massif'], 'nominal_width_km': 11}, {'id': 'mount-3', 'file': 'mount-3.png', 'width_px': 296, 'height_px': 99, 'profiles': ['massif', 'rocky'], 'nominal_width_km': 11}, {'id': 'mount-4', 'file': 'mount-4.png', 'width_px': 284, 'height_px': 96, 'profiles': ['rocky', 'massif'], 'nominal_width_km': 10}, {'id': 'mount-5', 'file': 'mount-5.png', 'width_px': 243, 'height_px': 112, 'profiles': ['rocky', 'ridge'], 'nominal_width_km': 8.5}, {'id': 'mount-6', 'file': 'mount-6.png', 'width_px': 257, 'height_px': 109, 'profiles': ['ridge', 'gentle'], 'nominal_width_km': 9}, {'id': 'mount-7', 'file': 'mount-7.png', 'width_px': 352, 'height_px': 100, 'profiles': ['gentle', 'ridge'], 'nominal_width_km': 12}, {'id': 'mount-8', 'file': 'mount-8.png', 'width_px': 301, 'height_px': 91, 'profiles': ['ridge', 'gentle'], 'nominal_width_km': 11}, {'id': 'mount-9', 'file': 'mount-9.png', 'width_px': 344, 'height_px': 99, 'profiles': ['gentle', 'ridge'], 'nominal_width_km': 12}, {'id': 'mount-10', 'file': 'mount-10.png', 'width_px': 280, 'height_px': 97, 'profiles': ['ridge', 'massif'], 'nominal_width_km': 10}, {'id': 'mount-11', 'file': 'mount-11.png', 'width_px': 158, 'height_px': 143, 'profiles': ['rocky', 'massif'], 'nominal_width_km': 6.5}, {'id': 'mount-12', 'file': 'mount-12.png', 'width_px': 322, 'height_px': 114, 'profiles': ['massif', 'ridge'], 'nominal_width_km': 11.5}, {'id': 'mount-13', 'file': 'mount-13.png', 'width_px': 329, 'height_px': 104, 'profiles': ['gentle', 'ridge'], 'nominal_width_km': 11}, {'id': 'mount-14', 'file': 'mount-14.png', 'width_px': 274, 'height_px': 84, 'profiles': ['gentle', 'ridge'], 'nominal_width_km': 10}, {'id': 'mount-15', 'file': 'mount-15.png', 'width_px': 239, 'height_px': 137, 'profiles': ['rocky', 'massif'], 'nominal_width_km': 8}, {'id': 'mount-16', 'file': 'mount-16.png', 'width_px': 312, 'height_px': 109, 'profiles': ['ridge', 'massif'], 'nominal_width_km': 10.5}, {'id': 'mount-17', 'file': 'mount-17.png', 'width_px': 316, 'height_px': 102, 'profiles': ['ridge', 'gentle'], 'nominal_width_km': 10.5}, {'id': 'mount-18', 'file': 'mount-18.png', 'width_px': 279, 'height_px': 100, 'profiles': ['ridge', 'rocky'], 'nominal_width_km': 9.5}, {'id': 'mount-19', 'file': 'mount-19.png', 'width_px': 229, 'height_px': 108, 'profiles': ['rocky', 'massif'], 'nominal_width_km': 8}, {'id': 'mount-20', 'file': 'mount-20.png', 'width_px': 313, 'height_px': 96, 'profiles': ['gentle', 'ridge'], 'nominal_width_km': 11}, {'id': 'mount-21', 'file': 'mount-21.png', 'width_px': 213, 'height_px': 118, 'profiles': ['massif', 'rocky'], 'nominal_width_km': 8}, {'id': 'mount-22', 'file': 'mount-22.png', 'width_px': 306, 'height_px': 103, 'profiles': ['ridge', 'massif'], 'nominal_width_km': 10.5}, {'id': 'mount-23', 'file': 'mount-23.png', 'width_px': 270, 'height_px': 98, 'profiles': ['massif', 'rocky'], 'nominal_width_km': 10}, {'id': 'mount-24', 'file': 'mount-24.png', 'width_px': 352, 'height_px': 99, 'profiles': ['gentle', 'ridge'], 'nominal_width_km': 12.5}, {'id': 'mount-25', 'file': 'mount-25.png', 'width_px': 248, 'height_px': 120, 'profiles': ['rocky', 'massif'], 'nominal_width_km': 7.5}, {'id': 'mount-26', 'file': 'mount-26.png', 'width_px': 315, 'height_px': 106, 'profiles': ['massif', 'ridge'], 'nominal_width_km': 11.5}, {'id': 'mount-27', 'file': 'mount-27.png', 'width_px': 256, 'height_px': 103, 'profiles': ['ridge', 'rocky'], 'nominal_width_km': 8.5}, {'id': 'mount-28', 'file': 'mount-28.png', 'width_px': 339, 'height_px': 89, 'profiles': ['gentle', 'ridge'], 'nominal_width_km': 12}, {'id': 'mount-29', 'file': 'mount-29.png', 'width_px': 302, 'height_px': 97, 'profiles': ['rocky', 'ridge'], 'nominal_width_km': 10}, {'id': 'mount-30', 'file': 'mount-30.png', 'width_px': 290, 'height_px': 91, 'profiles': ['ridge', 'gentle'], 'nominal_width_km': 10.5}], 'elbrus': {'id': 'elbrus', 'file': 'elbrus.png', 'width_px': 1020, 'height_px': 503, 'nominal_width_km': 44}}
PARAMS=[{'id': 1, 'peaks': [(0.51, 0.11499999999999999, 0.42)], 'hatch': 'right', 'round': False}, {'id': 2, 'peaks': [(0.29000000000000004, 0.35500000000000004, 0.28), (0.58, 0.195, 0.34), (0.81, 0.455, 0.2)], 'hatch': 'right', 'round': False}, {'id': 3, 'peaks': [(0.32, 0.36, 0.25), (0.52, 0.14, 0.34), (0.7, 0.32, 0.26)], 'hatch': 'left', 'round': False}, {'id': 4, 'peaks': [(0.28, 0.38, 0.25), (0.52, 0.16, 0.34), (0.74, 0.34, 0.26)], 'hatch': 'right', 'round': False}, {'id': 5, 'peaks': [(0.38, 0.19999999999999998, 0.34), (0.7, 0.44, 0.24)], 'hatch': 'right', 'round': False}, {'id': 6, 'peaks': [(0.35, 0.325, 0.28), (0.58, 0.16499999999999998, 0.34), (0.75, 0.425, 0.2)], 'hatch': 'left', 'round': False}, {'id': 7, 'peaks': [(0.33, 0.405, 0.32), (0.62, 0.28500000000000003, 0.34)], 'hatch': 'right', 'round': True}, {'id': 8, 'peaks': [(0.27, 0.36500000000000005, 0.28), (0.58, 0.205, 0.34), (0.8300000000000001, 0.465, 0.2)], 'hatch': 'right', 'round': False}, {'id': 9, 'peaks': [(0.36000000000000004, 0.39, 0.32), (0.62, 0.27, 0.34)], 'hatch': 'left', 'round': True}, {'id': 10, 'peaks': [(0.26, 0.39, 0.25), (0.52, 0.17, 0.34), (0.76, 0.35000000000000003, 0.26)], 'hatch': 'right', 'round': False}, {'id': 11, 'peaks': [(0.55, 0.095, 0.42)], 'hatch': 'right', 'round': False}, {'id': 12, 'peaks': [(0.29000000000000004, 0.375, 0.25), (0.52, 0.155, 0.34), (0.73, 0.335, 0.26)], 'hatch': 'left', 'round': False}, {'id': 13, 'peaks': [(0.31000000000000005, 0.41500000000000004, 0.32), (0.62, 0.29500000000000004, 0.34)], 'hatch': 'right', 'round': True}, {'id': 14, 'peaks': [(0.38, 0.38, 0.32), (0.62, 0.26, 0.34)], 'hatch': 'right', 'round': True}, {'id': 15, 'peaks': [(0.42, 0.18, 0.34), (0.7, 0.42, 0.24)], 'hatch': 'left', 'round': False}, {'id': 16, 'peaks': [(0.24000000000000002, 0.4, 0.25), (0.52, 0.18, 0.34), (0.78, 0.36000000000000004, 0.26)], 'hatch': 'right', 'round': False}, {'id': 17, 'peaks': [(0.35, 0.325, 0.28), (0.58, 0.16499999999999998, 0.34), (0.75, 0.425, 0.2)], 'hatch': 'right', 'round': False}, {'id': 18, 'peaks': [(0.31, 0.34500000000000003, 0.28), (0.58, 0.185, 0.34), (0.79, 0.445, 0.2)], 'hatch': 'left', 'round': False}, {'id': 19, 'peaks': [(0.37, 0.205, 0.34), (0.7, 0.445, 0.24)], 'hatch': 'right', 'round': False}, {'id': 20, 'peaks': [(0.36000000000000004, 0.39, 0.32), (0.62, 0.27, 0.34)], 'hatch': 'right', 'round': True}, {'id': 21, 'peaks': [(0.48, 0.13, 0.42)], 'hatch': 'left', 'round': False}, {'id': 22, 'peaks': [(0.37, 0.315, 0.28), (0.58, 0.155, 0.34), (0.73, 0.415, 0.2)], 'hatch': 'right', 'round': False}, {'id': 23, 'peaks': [(0.29000000000000004, 0.375, 0.25), (0.52, 0.155, 0.34), (0.73, 0.335, 0.26)], 'hatch': 'right', 'round': False}, {'id': 24, 'peaks': [(0.31000000000000005, 0.41500000000000004, 0.32), (0.62, 0.29500000000000004, 0.34)], 'hatch': 'left', 'round': True}, {'id': 25, 'peaks': [(0.54, 0.09999999999999999, 0.42)], 'hatch': 'right', 'round': False}, {'id': 26, 'peaks': [(0.28, 0.38, 0.25), (0.52, 0.16, 0.34), (0.74, 0.34, 0.26)], 'hatch': 'right', 'round': False}, {'id': 27, 'peaks': [(0.38, 0.19999999999999998, 0.34), (0.7, 0.44, 0.24)], 'hatch': 'left', 'round': False}, {'id': 28, 'peaks': [(0.37, 0.385, 0.32), (0.62, 0.265, 0.34)], 'hatch': 'right', 'round': True}, {'id': 29, 'peaks': [(0.27, 0.385, 0.25), (0.52, 0.165, 0.34), (0.75, 0.34500000000000003, 0.26)], 'hatch': 'right', 'round': False}, {'id': 30, 'peaks': [(0.29000000000000004, 0.42500000000000004, 0.32), (0.62, 0.30500000000000005, 0.34)], 'hatch': 'left', 'round': True}]

def silhouette_points(w,h,peaks,rounded=False):
    base=int(h*0.82)
    points=[(int(w*0.05),base)]
    cursor=0.05
    for x,y,spread in peaks:
        left=max(cursor+0.03,x-spread/2)
        right=min(0.95,x+spread/2)
        shoulder_y=base-int(h*(0.16 if rounded else 0.22))
        points.append((int(w*left),shoulder_y))
        points.append((int(w*x),int(h*y)))
        points.append((int(w*right),shoulder_y+int(h*0.05)))
        cursor=right
    points.append((int(w*0.95),base))
    return points

def interpolate_x(points,y,side):
    candidates=[]
    for (x1,y1),(x2,y2) in zip(points,points[1:]):
        if (y1<=y<=y2) or (y2<=y<=y1):
            if y2==y1: continue
            t=(y-y1)/(y2-y1)
            candidates.append(x1+(x2-x1)*t)
    if not candidates: return None
    return max(candidates) if side=='right' else min(candidates)

def draw_mount(path,w,h,peaks,hatch_side,rounded=False):
    scale=3
    image=Image.new('RGBA',(w*scale,h*scale),(0,0,0,0))
    draw=ImageDraw.Draw(image)
    raw=silhouette_points(w,h,peaks,rounded)
    pts=[(x*scale,y*scale) for x,y in raw]
    outline=max(5,round(min(w,h)*0.048))*scale
    draw.line(pts,fill=INK,width=outline,joint='curve')
    for y in range(int(h*0.25),int(h*0.74),max(7,int(h*0.07))):
        edge=interpolate_x(raw,y,hatch_side)
        if edge is None: continue
        center=w*0.52
        if hatch_side=='right': x1=int(center+w*0.03); x2=int(edge-w*0.03)
        else: x1=int(edge+w*0.03); x2=int(center-w*0.03)
        if x2-x1<8: continue
        draw.line((x1*scale,y*scale,x2*scale,y*scale),fill=HATCH,width=max(2,round(min(w,h)*0.014))*scale)
    image=image.resize((w,h),Image.Resampling.LANCZOS)
    image.save(path,optimize=True)

def main():
    out=Path('assets/mountains'); out.mkdir(parents=True,exist_ok=True)
    by_id={p['id']:p for p in PARAMS}
    for item in CATALOG['mountains']:
        p=by_id[int(item['id'].split('-')[1])]
        draw_mount(out/item['file'],item['width_px'],item['height_px'],p['peaks'],p['hatch'],p['round'])
    e=CATALOG['elbrus']
    draw_mount(out/e['file'],e['width_px'],e['height_px'],[(0.36,0.17,0.46),(0.64,0.12,0.48)],'right',True)
    (out/'catalog.json').write_text(json.dumps(CATALOG,ensure_ascii=False,indent=2),encoding='utf-8')
    assert len(list(out.glob('mount-*.png')))==30
    print(json.dumps({'mountains':30,'elbrus':str(out/e['file'])},ensure_ascii=False))

if __name__=='__main__': main()
