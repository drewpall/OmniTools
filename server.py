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
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        super().end_headers()

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
        else:
            self.send_response(404)
            self.end_headers()

def main():
    # Ensure we serve files from the directory of this script
    script_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(script_dir)
    
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
