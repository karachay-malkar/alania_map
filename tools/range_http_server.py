#!/usr/bin/env python3
from __future__ import annotations

import argparse
import mimetypes
import os
import re
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r'^bytes=(\d+)-(\d*)$')


class RangeRequestHandler(SimpleHTTPRequestHandler):
    protocol_version = 'HTTP/1.1'

    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            self._range = None
            return super().send_head()
        try:
            source = open(path,'rb')
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND,'File not found')
            return None

        size = os.fstat(source.fileno()).st_size
        content_type = mimetypes.guess_type(path)[0] or 'application/octet-stream'
        range_header = self.headers.get('Range')
        if not range_header:
            self.send_response(HTTPStatus.OK)
            self.send_header('Content-Type',content_type)
            self.send_header('Content-Length',str(size))
            self.send_header('Accept-Ranges','bytes')
            self.end_headers()
            self._range = None
            return source

        match = RANGE_RE.match(range_header.strip())
        if not match:
            source.close()
            self.send_error(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            return None
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) else size - 1
        if start >= size or end < start:
            source.close()
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header('Content-Range',f'bytes */{size}')
            self.end_headers()
            return None
        end = min(end,size - 1)
        length = end - start + 1
        source.seek(start)
        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header('Content-Type',content_type)
        self.send_header('Content-Length',str(length))
        self.send_header('Content-Range',f'bytes {start}-{end}/{size}')
        self.send_header('Accept-Ranges','bytes')
        self.end_headers()
        self._range = (start,end)
        return source

    def copyfile(self, source, outputfile):
        if not self._range:
            return super().copyfile(source,outputfile)
        start,end = self._range
        remaining = end - start + 1
        while remaining > 0:
            chunk = source.read(min(64 * 1024,remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('port',nargs='?',type=int,default=4173)
    parser.add_argument('--bind',default='127.0.0.1')
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.bind,args.port),RangeRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
