"""로컬 미리보기 서버 (캐시 없음). 실행: py tools/serve.py  →  http://localhost:5173
서버 함수(api/)는 실행되지 않으므로 앱은 '체험 모드'(브라우저 저장)로 동작한다."""
import http.server
import os

os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


NoCacheHandler.extensions_map['.js'] = 'text/javascript'
http.server.ThreadingHTTPServer(('', 5173), NoCacheHandler).serve_forever()
