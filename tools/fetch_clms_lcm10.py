#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import os
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

COLLECTION_ID = '828f6b20-8ffd-48f8-a1da-fefd271456db'
TOKEN_URL = 'https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token'
PROCESS_URL = 'https://sh.dataspace.copernicus.eu/api/v1/process'
CRS84 = 'http://www.opengis.net/def/crs/OGC/1.3/CRS84'

EVALSCRIPT = r'''//VERSION=3
function setup() {
  return {
    input: [{bands:["LCM10","dataMask"]}],
    output: {bands:4, sampleType:"UINT8"},
    mosaicking: "SIMPLE"
  };
}
function evaluatePixel(s) {
  if (!s.dataMask) return [0,0,0,0];
  const c = Math.round(s.LCM10);
  if (c === 10) return [58,101,61,220];      // tree cover
  if (c === 20) return [112,132,82,180];     // shrubland
  if (c === 30) return [151,166,103,165];    // grassland
  if (c === 40) return [164,157,112,105];    // cropland, subtle context
  if (c === 50) return [88,137,117,165];     // herbaceous wetland
  if (c === 60) return [66,123,91,180];      // mangroves
  if (c === 70) return [172,174,126,120];    // moss and lichen
  return [0,0,0,0];
}
'''


def post_json(url: str, payload: dict, token: str | None = None, timeout: int = 120) -> bytes:
    headers = {'Content-Type':'application/json','Accept':'image/tiff'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    request = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers, method='POST')
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def get_token(client_id: str, client_secret: str) -> str:
    body = urllib.parse.urlencode({
        'grant_type':'client_credentials',
        'client_id':client_id,
        'client_secret':client_secret,
    }).encode('utf-8')
    request = urllib.request.Request(TOKEN_URL, data=body, headers={'Content-Type':'application/x-www-form-urlencoded'}, method='POST')
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    token = payload.get('access_token')
    if not token:
        raise RuntimeError('CDSE token response did not contain access_token')
    return token


def request_payload(bbox: list[float], width: int, height: int) -> dict:
    return {
        'input': {
            'bounds': {'bbox': bbox, 'properties': {'crs': CRS84}},
            'data': [{
                'type': f'byoc-{COLLECTION_ID}',
                'dataFilter': {'timeRange': {'from':'2020-01-01T00:00:00Z','to':'2020-12-31T23:59:59Z'}}
            }]
        },
        'output': {
            'width': width,
            'height': height,
            'responses': [{'identifier':'default','format':{'type':'image/tiff'}}]
        },
        'evalscript': EVALSCRIPT
    }


def dimensions(bbox: list[float]) -> tuple[int,int]:
    west,south,east,north=bbox
    lat=(south+north)/2
    width=max(1, math.ceil((east-west)*111320*math.cos(math.radians(lat))/10))
    height=max(1, math.ceil((north-south)*110540/10))
    if width > 2400 or height > 2400:
        raise RuntimeError(f'chunk too large for Process API: {width}x{height} {bbox}')
    return width,height


def chunks(bounds: list[float], step: float):
    west,south,east,north=bounds
    y=south
    row=0
    while y < north - 1e-10:
        y2=min(north,y+step)
        x=west
        col=0
        while x < east - 1e-10:
            x2=min(east,x+step)
            yield row,col,[x,y,x2,y2]
            x=x2; col+=1
        y=y2; row+=1


def main() -> None:
    parser=argparse.ArgumentParser()
    parser.add_argument('--bounds-json',default='build/rectangular-bounds.json')
    parser.add_argument('--output-dir',default='build/clms-lcm10')
    parser.add_argument('--step',type=float,default=0.19)
    args=parser.parse_args()

    client_id=os.environ.get('CDSE_CLIENT_ID') or os.environ.get('SH_CLIENT_ID') or os.environ.get('COPERNICUS_CLIENT_ID')
    client_secret=os.environ.get('CDSE_CLIENT_SECRET') or os.environ.get('SH_CLIENT_SECRET') or os.environ.get('COPERNICUS_CLIENT_SECRET')
    if not client_id or not client_secret:
        raise RuntimeError('CDSE OAuth client credentials are not configured')

    bounds=json.loads(Path(args.bounds_json).read_text(encoding='utf-8'))['bounds']
    out=Path(args.output_dir)
    out.mkdir(parents=True,exist_ok=True)
    token=get_token(client_id,client_secret)
    completed=0
    for row,col,bbox in chunks(bounds,args.step):
        path=out/f'lcm10-r{row:02d}-c{col:02d}.tif'
        if path.exists() and path.stat().st_size>1000:
            completed+=1
            continue
        width,height=dimensions(bbox)
        payload=request_payload(bbox,width,height)
        for attempt in range(4):
            try:
                data=post_json(PROCESS_URL,payload,token)
                if len(data)<1000:
                    raise RuntimeError(f'LCM-10 response too small: {len(data)} bytes')
                path.write_bytes(data)
                completed+=1
                print(f'{path.name}: {width}x{height}, {len(data)} bytes')
                break
            except urllib.error.HTTPError as exc:
                if exc.code==401 and attempt<3:
                    token=get_token(client_id,client_secret)
                    continue
                if exc.code in {429,500,502,503,504} and attempt<3:
                    time.sleep(5*(attempt+1))
                    continue
                detail=exc.read().decode('utf-8','replace')[:1000]
                raise RuntimeError(f'LCM-10 Process API HTTP {exc.code}: {detail}') from exc
        else:
            raise RuntimeError(f'LCM-10 chunk failed: {bbox}')
    print(json.dumps({'collectionId':COLLECTION_ID,'bounds':bounds,'chunks':completed},indent=2))

if __name__=='__main__':
    main()
