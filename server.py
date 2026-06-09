import http.server
import socketserver
import os
import sys

PORT = 3000

class CrossOriginIsolationHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Inject the COOP/COEP headers to unlock SharedArrayBuffer (multi-threading)
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("Cross-Origin-Resource-Policy", "cross-origin")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

    def do_GET(self):
        from urllib.parse import urlparse, parse_qs, unquote
        parsed_url = urlparse(self.path)
        path = parsed_url.path

        if path == '/api/download-ipa':
            query_params = parse_qs(parsed_url.query)
            file_id = query_params.get('id', [''])[0]
            # Strip for path traversal safety
            file_id = os.path.basename(file_id)
            
            temp_dir = os.path.join(os.getcwd(), 'temp_ipas')
            file_path = os.path.join(temp_dir, f"{file_id}.ipa")
            
            if not file_id or not os.path.exists(file_path):
                self.send_response(404)
                self.end_headers()
                self.wfile.write(b"IPA file not found or expired.")
                return
            
            file_size = os.path.getsize(file_path)
            
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Disposition', f'attachment; filename="app_{file_id[:8]}.ipa"')
            self.send_header('Content-Length', str(file_size))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.end_headers()
            
            # Serve file in chunks
            chunk_size = 64 * 1024
            with open(file_path, 'rb') as f:
                while True:
                    chunk = f.read(chunk_size)
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    
        elif path == '/api/manifest':
            query_params = parse_qs(parsed_url.query)
            file_id = query_params.get('id', [''])[0]
            # Strip for path traversal safety
            file_id = os.path.basename(file_id)
            
            app_name = unquote(query_params.get('name', ['App'])[0])
            bundle_id = unquote(query_params.get('bundleId', ['com.custom.app'])[0])
            origin = unquote(query_params.get('origin', [''])[0])
            
            # If no origin was passed, construct it from Host header
            if not origin:
                host = self.headers.get('Host', f'localhost:{PORT}')
                proto = 'https' if self.headers.get('X-Forwarded-Proto') == 'https' else 'http'
                origin = f"{proto}://{host}"
                
            ipa_url = f"{origin}/api/download-ipa?id={file_id}"
            
            manifest_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>items</key>
    <array>
        <dict>
            <key>assets</key>
            <array>
                <dict>
                    <key>kind</key>
                    <string>software-package</string>
                    <key>url</key>
                    <string>{ipa_url}</string>
                </dict>
            </array>
            <key>metadata</key>
            <dict>
                <key>bundle-identifier</key>
                <string>{bundle_id}</string>
                <key>bundle-version</key>
                <string>1.0</string>
                <key>kind</key>
                <string>software</string>
                <key>title</key>
                <string>{app_name}</string>
            </dict>
        </dict>
    </array>
</dict>
</plist>"""
            self.send_response(200)
            self.send_header('Content-Type', 'text/xml; charset=utf-8')
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Cross-Origin-Opener-Policy", "same-origin")
            self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
            self.end_headers()
            self.wfile.write(manifest_xml.encode('utf-8'))
            
        else:
            super().do_GET()

    def do_POST(self):
        if self.path == '/api/send-email':
            import json
            import smtplib
            from email.mime.text import MIMEText
            from email.mime.multipart import MIMEMultipart

            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode('utf-8'))
                host = data.get('smtpHost')
                port = int(data.get('smtpPort', 465))
                secure = data.get('secure', True)
                user = data.get('user')
                password = data.get('pass')
                to_addr = data.get('to')
                subject = data.get('subject')
                body = data.get('body')
                content_type = data.get('contentType', 'HTML')

                # Prepare email
                msg = MIMEMultipart('alternative')
                msg['Subject'] = subject
                msg['From'] = user
                msg['To'] = to_addr

                if content_type.upper() == 'HTML':
                    msg.attach(MIMEText(body, 'html', 'utf-8'))
                else:
                    msg.attach(MIMEText(body, 'plain', 'utf-8'))

                # Connect and send with relaxed SSL context to handle certificate handshake quirks
                import ssl
                context = ssl.create_default_context()
                context.check_hostname = False
                context.verify_mode = ssl.CERT_NONE

                if secure or port == 465:
                    server = smtplib.SMTP_SSL(host, port, timeout=12, context=context)
                else:
                    server = smtplib.SMTP(host, port, timeout=12)
                    try:
                        server.starttls(context=context)
                    except Exception as te:
                        print("STARTTLS warning:", te)
                
                server.login(user, password)
                server.sendmail(user, [to_addr], msg.as_string())
                server.quit()

                # Return success
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                # Inject CORS/COOP for consistency
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "message": "Email sent successfully"}).encode('utf-8'))
            except Exception as e:
                # Return failure
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
        elif self.path == '/api/parse-plist':
            import plistlib
            import json
            import base64
            import datetime
            
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing Content-Length")
                return
                
            try:
                plist_bytes = self.rfile.read(content_length)
                plist_data = plistlib.loads(plist_bytes)
                
                # Convert to JSON serializable structure
                def plist_to_jsonable(obj):
                    if isinstance(obj, dict):
                        return {k: plist_to_jsonable(v) for k, v in obj.items()}
                    elif isinstance(obj, list):
                        return [plist_to_jsonable(v) for v in obj]
                    elif isinstance(obj, bytes):
                        return {"__type__": "bytes", "data": base64.b64encode(obj).decode('utf-8')}
                    elif isinstance(obj, datetime.datetime):
                        return {"__type__": "date", "data": obj.isoformat()}
                    else:
                        return obj
                
                serializable_data = plist_to_jsonable(plist_data)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "data": serializable_data}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
        elif self.path == '/api/build-plist':
            import plistlib
            import json
            import base64
            import datetime
            
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing Content-Length")
                return
                
            try:
                post_data = self.rfile.read(content_length)
                request_data = json.loads(post_data.decode('utf-8'))
                raw_plist_jsonable = request_data.get('data')
                
                def jsonable_to_plist(obj):
                    if isinstance(obj, dict):
                        if "__type__" in obj and "data" in obj:
                            t = obj["__type__"]
                            if t == "bytes":
                                return base64.b64decode(obj["data"])
                            elif t == "date":
                                return datetime.datetime.fromisoformat(obj["data"])
                        return {k: jsonable_to_plist(v) for k, v in obj.items()}
                    elif isinstance(obj, list):
                        return [jsonable_to_plist(v) for v in obj]
                    else:
                        return obj
                
                plist_data = jsonable_to_plist(raw_plist_jsonable)
                binary_bytes = plistlib.dumps(plist_data, fmt=plistlib.FMT_BINARY)
                
                self.send_response(200)
                self.send_header('Content-Type', 'application/octet-stream')
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
                self.end_headers()
                self.wfile.write(binary_bytes)
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
        elif self.path == '/api/upload-ipa':
            import uuid
            import json
            content_length = int(self.headers.get('Content-Length', 0))
            if content_length == 0:
                self.send_response(400)
                self.end_headers()
                self.wfile.write(b"Missing Content-Length")
                return
            
            # Generate a unique file ID
            file_id = str(uuid.uuid4())
            temp_dir = os.path.join(os.getcwd(), 'temp_ipas')
            if not os.path.exists(temp_dir):
                os.makedirs(temp_dir)
            
            file_path = os.path.join(temp_dir, f"{file_id}.ipa")
            
            # Read and write in chunks to save memory
            chunk_size = 64 * 1024
            remaining = content_length
            try:
                with open(file_path, 'wb') as f:
                    while remaining > 0:
                        to_read = min(remaining, chunk_size)
                        chunk = self.rfile.read(to_read)
                        if not chunk:
                            break
                        f.write(chunk)
                        remaining -= len(chunk)
                
                # Respond with JSON
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cross-Origin-Opener-Policy", "same-origin")
                self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
                self.end_headers()
                self.wfile.write(json.dumps({"success": True, "id": file_id}).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode('utf-8'))
        else:
            self.send_response(404)
            self.end_headers()

def main():
    # Ensure we serve files from the directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
    # Create temp_ipas folder and clean it up on startup
    temp_dir = os.path.join(script_dir, 'temp_ipas')
    if not os.path.exists(temp_dir):
        os.makedirs(temp_dir)
    else:
        # Delete existing files in the temp_ipas directory
        for f in os.listdir(temp_dir):
            file_path = os.path.join(temp_dir, f)
            try:
                if os.path.isfile(file_path):
                    os.unlink(file_path)
            except Exception as e:
                print(f"Error deleting temp file {file_path}: {e}")
                
    # Configure and start server
    handler = CrossOriginIsolationHandler
    
    # Enable address reuse to avoid port collision immediately after restarts
    socketserver.TCPServer.allow_reuse_address = True
    
    try:
        with socketserver.TCPServer(("", PORT), handler) as httpd:
            print(f"\n==================================================")
            print(f"** [OmniToolbox] Python Local Server is running!")
            print(f"   Address: http://localhost:{PORT}")
            print(f"   Cross-Origin Isolation headers have been injected.")
            print(f"==================================================")
            print("Press Ctrl+C to stop the server.\n")
            httpd.serve_forever()
    except OSError as e:
        if e.errno == 98 or e.errno == 10048: # Address already in use
            print(f"Port {PORT} is already in use. Please close the other process or change the port.")
        else:
            print(f"Error starting server: {e}")
    except KeyboardInterrupt:
        print("\nStopping server... Goodbye!")
        sys.exit(0)

if __name__ == "__main__":
    main()
