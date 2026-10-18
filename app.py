import os
import json
import time
import re
import requests
from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
from dotenv import load_dotenv
from PIL import Image
from io import BytesIO
import urllib.request

try:
    from coverpy import CoverPy
    client = CoverPy()
    COVERPY_DISPONIVEL = True
except Exception as e:
    print(f"Coverpy não disponível: {e}")
    client = None
    COVERPY_DISPONIVEL = False

load_dotenv()

app = Flask(__name__)
CORS(app)

LASTFM_API_KEY = os.getenv("LASTFM_API_KEY")

cache_capas = {}
cache_aritra = {}
cache_capas_alternativas = {}

ARITRA_API = "https://api.aritra.ovh/v1"

def calcular_cor_dominante(url_imagem):
    try:
        with urllib.request.urlopen(url_imagem, timeout=5) as resp:
            img = Image.open(BytesIO(resp.read())).convert('RGB')
            img = img.resize((100, 100))
            pixels = list(img.getdata())
            baldes = {}
            for pixel in pixels:
                r, g, b = pixel
                if r > 95 and g > 40 and b > 20:
                    max_c = max(r, g, b)
                    min_c = min(r, g, b)
                    if (max_c - min_c) > 15 and abs(r - g) > 15 and r > g and r > b:
                        if r - g > 20 and r - b > 30 and g > b: continue
                chave = (r // 32, g // 32, b // 32)
                if chave not in baldes: baldes[chave] = {"count": 0, "r": 0, "g": 0, "b": 0}
                baldes[chave]["count"] += 1
                baldes[chave]["r"] += r
                baldes[chave]["g"] += g
                baldes[chave]["b"] += b
            melhor = None
            for b in baldes.values():
                brilho = (b["r"] // b["count"] + b["g"] // b["count"] + b["b"] // b["count"]) / 3
                if not (25 < brilho < 245): continue
                if melhor is None or b["count"] > melhor["count"]: melhor = b
            if not melhor: return {"r": 40, "g": 40, "b": 40}
            return {"r": melhor["r"] // melhor["count"], "g": melhor["g"] // melhor["count"], "b": melhor["b"] // melhor["count"]}
    except Exception: return {"r": 40, "g": 40, "b": 40}

def buscar_url_apple_music(artist, album):
    try:
        params = {"term": f"{artist} {album}", "media": "music", "entity": "album", "limit": 1}
        resp = requests.get("https://itunes.apple.com/search", params=params, timeout=10)
        data = resp.json()
        if data.get("resultCount", 0) > 0: return data["results"][0].get("collectionViewUrl", "")
    except Exception: pass
    return None

def extrair_variante_hls(hls_url, resolucao_desejada=None):
    try:
        resp = requests.get(hls_url, timeout=10)
        if resp.status_code != 200: return None
        linhas = resp.text.split('\n')
        base_url = hls_url.rsplit('/', 1)[0]
        variantes = []
        for i, linha in enumerate(linhas):
            linha = linha.strip()
            if linha.startswith('#EXT-X-STREAM-INF') and 'RESOLUTION=' in linha:
                m = re.search(r'RESOLUTION=(\d+)x(\d+)', linha)
                if m and i + 1 < len(linhas):
                    proxima = linhas[i + 1].strip()
                    if proxima and not proxima.startswith('#'):
                        url = proxima if proxima.startswith('http') else f"{base_url}/{proxima}"
                        variantes.append((int(m.group(1)), url))
        if not variantes:
            for linha in linhas:
                linha = linha.strip()
                if linha and not linha.startswith('#'):
                    return linha if linha.startswith('http') else f"{base_url}/{linha}"
            return None
        if resolucao_desejada:
            alvo = int(resolucao_desejada.split('x')[0])
            iguais = [v for v in variantes if v[0] == alvo]
            if iguais: return iguais[0][1]
        variantes.sort(key=lambda x: x[0], reverse=True)
        return variantes[0][1]
    except Exception: return None

def buscar_capa_animada_aritra(artist, album):
    chave = f"{artist}::{album}".lower()
    if chave in cache_aritra:
        entrada = cache_aritra[chave]
        if time.time() - entrada["timestamp"] < 86400: return entrada["video_url"]
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
        video_url = extrair_variante_hls(hls_url, "1080x1080") or extrair_variante_hls(hls_url, "720x720") or extrair_variante_hls(hls_url, "540x540") or extrair_variante_hls(hls_url)
    except Exception: pass
    cache_aritra[chave] = {"video_url": video_url, "timestamp": time.time()}
    return video_url

def buscar_capa_com_cache(artist, album):
    chave = f"{artist}::{album}".lower()
    if chave in cache_capas:
        entrada = cache_capas[chave]
        if time.time() - entrada["timestamp"] < 300: return entrada["static_url"], entrada["video_url"]
    static_url = None
    video_url = None
    if COVERPY_DISPONIVEL and client:
        try:
            results = client.search(f"{artist} {album}", limit=1)
            if results:
                static_url = results[0].artwork(1200)
                motion = client.get_motion_artwork(results[0])
                if motion: video_url = motion.video_url
        except Exception: pass
    if not static_url:
        try:
            params = {"term": f"{artist} {album}", "media": "music", "entity": "album", "limit": 1}
            resp = requests.get("https://itunes.apple.com/search", params=params, timeout=10)
            data = resp.json()
            if data.get("resultCount", 0) > 0:
                artwork = data["results"][0].get("artworkUrl100", "")
                if artwork: static_url = artwork.replace("100x100", "1200x1200")
        except Exception: pass
    cache_capas[chave] = {"static_url": static_url, "video_url": video_url, "timestamp": time.time()}
    return static_url, video_url

@app.route('/')
def home(): return send_from_directory('.', 'index.html')

@app.route('/visualizador')
def visualizador(): return send_from_directory('.', 'index.html')

@app.route('/style.css')
def servir_css(): return send_from_directory('static', 'style.css')

@app.route('/script.js')
def servir_js(): return send_from_directory('static', 'script.js')

@app.route('/last.svg')
def servir_last(): return send_from_directory('static', 'last.svg')

@app.route('/overlay.png')
def servir_overlay(): return send_from_directory('static', 'overlay.png')

@app.route('/fonts/<path:nome>')
def servir_font(nome): return send_from_directory('static/fonts', nome)

@app.route('/api/capas-alternativas')
def capas_alternativas():
    artist = request.args.get('artist', '')
    track = request.args.get('track', '')
    if not artist or not track: return jsonify({"error": "artist e track obrigatórios"}), 400
    chave_cache = f"{artist}::{track}".lower()
    if chave_cache in cache_capas_alternativas:
        entrada = cache_capas_alternativas[chave_cache]
        if time.time() - entrada["timestamp"] < 3600: return jsonify(entrada["resultados"])
    resultados = []
    vistos = set()
    try:
        params = {"term": f"{artist} {track}", "media": "music", "entity": "album", "limit": 50, "country": "US"}
        resp = requests.get("https://itunes.apple.com/search", params=params, timeout=10)
        data = resp.json()
        for item in data.get("results", []):
            album = item.get("collectionName", "")
            artwork = item.get("artworkUrl100", "")
            apple_url = item.get("collectionViewUrl", "")
            if not artwork: continue
            artwork = artwork.replace("100x100", "1200x1200")
            if artwork in vistos: continue
            vistos.add(artwork)
            video_url = None
            if apple_url:
                try:
                    resp_covers = requests.get(f"{ARITRA_API}/covers", params={"url": apple_url}, timeout=10)
                    if resp_covers.status_code == 200:
                        covers_data = resp_covers.json()
                        master = covers_data.get("master", {})
                        hls = master.get("square") or master.get("tall")
                        if hls: video_url = extrair_variante_hls(hls, "1080x1080") or extrair_variante_hls(hls, "720x720") or extrair_variante_hls(hls, "540x540") or extrair_variante_hls(hls)
                except Exception: pass
            resultados.append({"album": album, "static_url": artwork, "video_url": video_url, "tem_animada": bool(video_url)})
    except Exception as e: return jsonify({"error": str(e)}), 500
    resultados.sort(key=lambda x: (not x["tem_animada"], x["album"]))
    cache_capas_alternativas[chave_cache] = {"resultados": resultados, "timestamp": time.time()}
    return jsonify(resultados)

@app.route('/api/lastfm/now-playing')
def lastfm_now_playing():
    username = request.args.get('user')
    if not username: return jsonify({"error": "User parameter is required"}), 400
    params = {"method": "user.getrecenttracks", "user": username, "api_key": LASTFM_API_KEY, "format": "json", "limit": 5}
    try:
        response = None
        for tentativa in range(3):
            try:
                params["_"] = int(time.time())
                response = requests.get("https://ws.audioscrobbler.com/2.0/", params=params, timeout=10)
                if response.status_code == 200: break
                time.sleep(1)
            except requests.RequestException: time.sleep(1)
        if not response or response.status_code != 200: return jsonify({"error": "Last.fm indisponível"}), 503
        data = response.json()
        if "error" in data: return jsonify({"error": data.get("message")}), 404
        if "recenttracks" not in data: return jsonify({"error": "Sem dados"}), 404
        tracks_raw = data["recenttracks"].get("track", [])
        tracks = [tracks_raw] if isinstance(tracks_raw, dict) else tracks_raw
        if not tracks: return jsonify({"error": "Nenhuma música"}), 404
        track = tracks[0]
        artist_name = track.get("artist", {}).get("#text", "")
        track_name = track.get("name", "")
        album_data = track.get("album", {})
        album_name = album_data.get("#text", "") if isinstance(album_data, dict) else ""
        is_now_playing = track.get("@attr", {}).get("nowplaying") == "true"
        lastfm_image = track.get("image", [])[-1].get("#text", "") if track.get("image") else ""
        if not track_name or not artist_name: return jsonify({"error": "Dados incompletos"}), 404
        if not album_name or not album_name.strip():
            try:
                info_params = {"method": "track.getInfo", "artist": artist_name, "track": track_name, "api_key": LASTFM_API_KEY, "format": "json"}
                info_response = requests.get("https://ws.audioscrobbler.com/2.0/", params=info_params, timeout=10)
                info_data = info_response.json()
                album_info = info_data.get("track", {}).get("album", {})
                if album_info and album_info.get("title"): album_name = album_info["title"]
            except Exception: pass
        video_url = None
        if album_name and album_name.strip(): video_url = buscar_capa_animada_aritra(artist_name, album_name)
        static_url = None
        if not video_url:
            static_url, video_url_coverpy = buscar_capa_com_cache(artist_name, album_name)
            if video_url_coverpy: video_url = video_url_coverpy
        else: static_url, _ = buscar_capa_com_cache(artist_name, album_name)
        if not static_url and lastfm_image: static_url = lastfm_image
        cor_dominante = {"r": 40, "g": 40, "b": 40}
        if static_url: cor_dominante = calcular_cor_dominante(static_url)
        return jsonify({
            "artist": artist_name, "track": track_name, "album": album_name,
            "is_now_playing": is_now_playing, "video_url": video_url,
            "static_url": static_url, "dominant_color": cor_dominante
        })
    except Exception as e: return jsonify({"error": str(e)}), 500

if __name__ == '__main__': app.run(debug=True, port=5000, host='0.0.0.0')
