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
