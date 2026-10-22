import os
import time
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO
import urllib.request

load_dotenv()

app = Flask(__name__)
CORS(app)

LASTFM_API_KEY = os.getenv("LASTFM_API_KEY")

cache_capas = {}
cache_aritra = {}

ARITRA_API = "https://api.aritra.ovh/v1"

# ============================================
# FUNÇÕES AUXILIARES
# ============================================

def calcular_cor_dominante(url_imagem):
    try:
        with urllib.request.urlopen(url_imagem, timeout=5) as resp:
            img = Image.open(BytesIO(resp.read())).convert('RGB')
            img = img.resize((80, 80))
            baldes = {}
            for pixel in img.getdata():
                r, g, b = pixel
                chave = (r // 32, g // 32, b // 32)
                if chave not in baldes:
                    baldes[chave] = {"count": 0, "r": 0, "g": 0, "b": 0}
                baldes[chave]["count"] += 1
                baldes[chave]["r"] += r
                baldes[chave]["g"] += g
                baldes[chave]["b"] += b
            ordenados = sorted(baldes.values(), key=lambda x: x["count"], reverse=True)
            filtrados = []
            for b in ordenados:
                r = b["r"] // b["count"]
                g = b["g"] // b["count"]
                bl = b["b"] // b["count"]
                brilho = (r + g + bl) / 3
                if 25 < brilho < 230:
                    filtrados.append(b)
            if len(filtrados) >= 2:
                alvo = filtrados[1]
            elif len(filtrados) == 1:
                alvo = filtrados[0]
            else:
                return {"r": 40, "g": 40, "b": 40}
            return {"r": alvo["r"] // alvo["count"], "g": alvo["g"] // alvo["count"], "b": alvo["b"] // alvo["count"]}
    except Exception:
        return {"r": 40, "g": 40, "b": 40}

def buscar_url_apple_music(artist, album):
    try:
        itunes_url = "https://itunes.apple.com/search"
        params = {"term": f"{artist} {album}", "media": "music", "entity": "album", "limit": 1}
        resp = requests.get(itunes_url, params=params, timeout=10)
        data = resp.json()
        if data.get("resultCount", 0) > 0:
            return data["results"][0].get("collectionViewUrl", "")
    except Exception:
        pass
    return None

def extrair_variante_hls(hls_url, resolucao_desejada="1080x1080"):
    try:
        resp = requests.get(hls_url, timeout=10)
        if resp.status_code != 200:
            return None

        linhas = resp.text.split('\n')
        base_url = hls_url.rsplit('/', 1)[0]

        for i, linha in enumerate(linhas):
            linha = linha.strip()
            if resolucao_desejada in linha and linha.startswith('#'):
                for j in range(i + 1, len(linhas)):
                    proxima = linhas[j].strip()
                    if proxima and not proxima.startswith('#'):
                        if proxima.startswith('http'):
                            return proxima
                        return f"{base_url}/{proxima}"
            elif resolucao_desejada in linha and not linha.startswith('#'):
                if linha.startswith('http'):
                    return linha
                return f"{base_url}/{linha}"

        for i, linha in enumerate(linhas):
            linha = linha.strip()
            if "720x720" in linha and linha.startswith('#'):
                for j in range(i + 1, len(linhas)):
                    proxima = linhas[j].strip()
                    if proxima and not proxima.startswith('#'):
                        if proxima.startswith('http'):
                            return proxima
                        return f"{base_url}/{proxima}"
            elif "720x720" in linha and not linha.startswith('#'):
                if linha.startswith('http'):
                    return linha
                return f"{base_url}/{linha}"

        for linha in linhas:
            linha = linha.strip()
            if linha and not linha.startswith('#'):
                if linha.startswith('http'):
                    return linha
                return f"{base_url}/{linha}"
    except Exception:
        pass
    return None

def buscar_capa_animada_aritra(artist, album):
    chave = f"{artist}::{album}".lower()
    if chave in cache_aritra:
        entrada = cache_aritra[chave]
        if time.time() - entrada["timestamp"] < 86400:
            return entrada["video_url"]

    video_url = None
    apple_url = buscar_url_apple_music(artist, album)
    
    if not apple_url:
        cache_aritra[chave] = {"video_url": None, "timestamp": time.time()}
        return None

    try:
        resp_covers = requests.get(f"{ARITRA_API}/covers", params={"url": apple_url}, timeout=15)
        if resp_covers.status_code != 200:
            cache_aritra[chave] = {"video_url": None, "timestamp": time.time()}
            return None

        data_covers = resp_covers.json()
        master = data_covers.get("master", {})
        hls_url = master.get("square") or master.get("tall")

        if not hls_url:
            cache_aritra[chave] = {"video_url": None, "timestamp": time.time()}
            return None

        video_url = extrair_variante_hls(hls_url, "1080x1080")
        if not video_url:
            video_url = extrair_variante_hls(hls_url, "720x720")
        if not video_url:
            video_url = extrair_variante_hls(hls_url)

    except Exception as e:
        print(f"Erro ao consultar aritra.ovh: {e}")

    cache_aritra[chave] = {"video_url": video_url, "timestamp": time.time()}
    return video_url

def buscar_capa_estatica(artist, album):
    chave = f"{artist}::{album}".lower()
    if chave in cache_capas:
        return cache_capas[chave]

    try:
        itunes_url = "https://itunes.apple.com/search"
        params = {"term": f"{artist} {album}", "media": "music", "entity": "album", "limit": 1}
        resp = requests.get(itunes_url, params=params, timeout=10)
        data = resp.json()
        if data.get("resultCount", 0) > 0:
            artwork = data["results"][0].get("artworkUrl100", "")
            if artwork:
                static_url = artwork.replace("100x100", "1200x1200")
                cache_capas[chave] = static_url
                return static_url
    except Exception:
        pass
    return None

# ============================================
# ROTAS DE ARQUIVOS
# ============================================

@app.route('/')
def home():
    return jsonify({"status": "online"})

@app.route('/visualizador')
def visualizador():
    return send_from_directory('.', 'index.html')

@app.route('/style.css')
def servir_css():
    return send_from_directory('static', 'style.css')

@app.route('/script.js')
def servir_js():
    return send_from_directory('static', 'script.js')

@app.route('/last.svg')
def servir_last():
    return send_from_directory('static', 'last.svg')

@app.route('/overlay.png')
def servir_overlay():
    return send_from_directory('static', 'overlay.png')

@app.route('/fonts/<path:nome>')
def servir_font(nome):
    return send_from_directory('static/fonts', nome)

# ============================================
# ROTA DE PRÉVIA (APPLE MUSIC)
# ============================================

@app.route('/api/previa')
def buscar_previa():
    artist = request.args.get('artist', '')
    track = request.args.get('track', '')

    if not artist or not track:
        return jsonify({"error": "Artista e música são obrigatórios"}), 400

    try:
        url = f"https://itunes.apple.com/search?term={artist}+{track}&entity=song&limit=1"
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(url, headers=headers, timeout=10).json()

        if resp.get('resultCount', 0) > 0:
            preview_url = resp['results'][0].get('previewUrl', '')
            return jsonify({"previewUrl": preview_url})
        else:
            return jsonify({"previewUrl": ""}), 404
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============================================
# ROTA DO LAST.FM
# ============================================

@app.route('/api/lastfm/now-playing')
def lastfm_now_playing():
    username = request.args.get('user')
    if not username:
        return jsonify({"error": "User parameter is required"}), 400

    lastfm_url = "https://ws.audioscrobbler.com/2.0/"
    params = {"method": "user.getrecenttracks", "user": username, "api_key": LASTFM_API_KEY, "format": "json", "limit": 1}

    try:
        response = None
        for tentativa in range(3):
            try:
                response = requests.get(lastfm_url, params=params, timeout=10)
                if response.status_code == 200:
                    break
                time.sleep(1)
            except requests.RequestException:
                time.sleep(1)

        if not response or response.status_code != 200:
            return jsonify({"error": "Last.fm indisponível."}), 503

        data = response.json()

        if "error" in data:
            return jsonify({"error": data.get("message", "Usuário não encontrado")}), 404

        tracks_raw = data["recenttracks"].get("track", [])
        tracks = [tracks_raw] if isinstance(tracks_raw, dict) else tracks_raw

        if not tracks:
            return jsonify({"error": "Nenhuma música recente"}), 404

        track = tracks[0]
        artist_name = track.get("artist", {}).get("#text", "")
        track_name = track.get("name", "")
        album_data = track.get("album", {})
        album_name = album_data.get("#text", "") if isinstance(album_data, dict) else ""
        
        if not album_name or not album_name.strip():
            try:
                info_params = {"method": "track.getInfo", "artist": artist_name, "track": track_name, "api_key": LASTFM_API_KEY, "format": "json"}
                info_response = requests.get(lastfm_url, params=info_params, timeout=10)
                info_data = info_response.json()
                album_info = info_data.get("track", {}).get("album", {})
                if album_info and album_info.get("title"):
                    album_name = album_info["title"]
            except Exception:
                pass

        user_image = ""
        scrobbles = 0
        try:
            user_info_params = {"method": "user.getinfo", "user": username, "api_key": LASTFM_API_KEY, "format": "json"}
            user_resp = requests.get(lastfm_url, params=user_info_params, timeout=10).json()
            if 'user' in user_resp and 'image' in user_resp['user']:
                imgs = user_resp['user']['image']
                if imgs: user_image = imgs[-1].get('#text', '')
            
            track_info_params = {"method": "track.getInfo", "artist": artist_name, "track": track_name, "username": username, "api_key": LASTFM_API_KEY, "format": "json"}
            track_resp = requests.get(lastfm_url, params=track_info_params, timeout=10).json()
            if 'track' in track_resp and 'userplaycount' in track_resp['track']:
                scrobbles = int(track_resp['track']['userplaycount'])
        except Exception:
            pass

        video_url = None
        static_url = buscar_capa_estatica(artist_name, album_name)
        
        if album_name and album_name.strip():
            video_url = buscar_capa_animada_aritra(artist_name, album_name)

        if not static_url:
            images = track.get("image", [])
            if images: static_url = images[-1].get("#text", "")

        cor_dominante = {"r": 40, "g": 40, "b": 40}
        if static_url:
            cor_dominante = calcular_cor_dominante(static_url)

        return jsonify({
            "artist": artist_name,
            "track": track_name,
            "album": album_name,
            "video_url": video_url,
            "static_url": static_url,
            "user_image": user_image,
            "scrobbles": scrobbles,
            "dominant_color": cor_dominante
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============================================
# ROTA DE RECOMENDAÇÕES
# ============================================

@app.route('/api/recomendacoes')
def recomendacoes():
    artist = request.args.get('artist', '')
    if not artist:
        return jsonify({"error": "Artista não fornecido"}), 400

    try:
        url = f"https://itunes.apple.com/search?term={artist}&entity=song&limit=10&sort=popular"
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(url, headers=headers, timeout=10).json()
        
        resultados = []
        for item in resp.get('results', []):
            resultados.append({
                "trackName": item.get('trackName', ''),
                "artistName": item.get('artistName', ''),
                "artworkUrl100": item.get('artworkUrl100', '')
            })
        
        return jsonify(resultados)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# ============================================
# INICIALIZAÇÃO
# ============================================

if __name__ == '__main__':
    app.run(debug=True, port=5000, host='0.0.0.0')
