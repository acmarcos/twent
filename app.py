import os
from flask import Flask, request, jsonify, send_from_directory
import requests
from dotenv import load_dotenv

# Carrega a chave do arquivo .env
load_dotenv()

app = Flask(__name__)

# Pega a chave do .env
LASTFM_API_KEY = os.getenv("API_KEY") or os.getenv("LASTFM_API_KEY") or "SUA_CHAVE_API_AQUI"

@app.route('/')
@app.route('/visualizador')
def index():
    return send_from_directory('.', 'index.html')

@app.route('/favicon.ico')
def favicon():
    return '', 204

@app.route('/style.css')
def serve_css():
    if os.path.exists('style.css'): return send_from_directory('.', 'style.css', mimetype='text/css')
    elif os.path.exists('static/style.css'): return send_from_directory('static', 'style.css', mimetype='text/css')
    return "CSS não encontrado", 404

@app.route('/script.js')
def serve_js():
    if os.path.exists('script.js'): return send_from_directory('.', 'script.js', mimetype='application/javascript')
    elif os.path.exists('static/script.js'): return send_from_directory('static', 'script.js', mimetype='application/javascript')
    return "JS não encontrado", 404

@app.route('/<path:filename>')
def serve_static(filename):
    if os.path.exists(filename): return send_from_directory('.', filename)
    elif os.path.exists(os.path.join('static', filename)): return send_from_directory('static', filename)
    return "Arquivo não encontrado", 404

@app.route('/api/lastfm/now-playing', methods=['GET'])
def now_playing():
    user = request.args.get('user')
    if not user:
        return jsonify({"error": "Usuário não fornecido"}), 400

    try:
        # 1. Música atual
        url_playing = f"http://ws.audioscrobbler.com/2.0/?method=user.getrecenttracks&user={user}&api_key={LASTFM_API_KEY}&format=json&limit=1"
        resp_playing = requests.get(url_playing).json()
        
        if 'error' in resp_playing:
            return jsonify({"error": resp_playing['message']}), 400
            
        track_info = resp_playing['recenttracks']['track']
        if isinstance(track_info, list):
            track_info = track_info[0]
            
        artist = track_info['artist']['#text']
        track = track_info['name']
        
        # Blindagem: Álbum pode vir vazio em scrobbles de vídeo
        album = ""
        if isinstance(track_info.get('album'), dict):
            album = track_info['album'].get('#text', '')
        
        # Blindagem: Imagem da capa
        images = track_info.get('image', [])
        static_url = ""
        if images and isinstance(images, list) and len(images) > 0:
            static_url = images[-1].get('#text', '')

        # 2. Foto do usuário (Pega GIF se existir)
        url_user = f"http://ws.audioscrobbler.com/2.0/?method=user.getinfo&user={user}&api_key={LASTFM_API_KEY}&format=json"
        resp_user = requests.get(url_user).json()
        
        user_image = ""
        if 'user' in resp_user and 'image' in resp_user['user']:
            user_images = resp_user['user']['image']
            if user_images:
                # Pega a última imagem (geralmente é a maior/extralarge)
                user_image = user_images[-1].get('#text', '')
                
        # 3. Scrobbles do usuário na faixa atual
        url_track = f"http://ws.audioscrobbler.com/2.0/?method=track.getInfo&api_key={LASTFM_API_KEY}&artist={artist}&track={track}&username={user}&format=json"
        resp_track = requests.get(url_track).json()
        
        scrobbles = 0
        if 'track' in resp_track and 'userplaycount' in resp_track['track']:
            scrobbles = int(resp_track['track']['userplaycount'])

        # Retorna os dados mastigados pro Front-end
        return jsonify({
            "track": track,
            "artist": artist,
            "album": album,
            "static_url": static_url,
            "video_url": "", 
            "user_image": user_image,
            "scrobbles": scrobbles,
            "dominant_color": {"r": 30, "g": 30, "b": 30} 
        })
        
    except Exception as e:
        # Se algo quebrar, ele printa no terminal do Termux e não dá erro no navegador
        print(f"\n❌ ERRO NA API: {e}\n")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    # Print para confirmar que a chave foi lida
    print(f"\n✅ API KEY CARREGADA: {LASTFM_API_KEY[:5]}... (Tamanho: {len(LASTFM_API_KEY)} caracteres)\n")
    app.run(host='127.0.0.1', port=5000, debug=True)
