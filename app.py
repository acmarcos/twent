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

ARITRA_API = "https://api.aritra.ovh/v1"

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
    """Busca a URL do álbum no Apple Music usando o iTunes Search API."""
    try:
        itunes_url = "https://itunes.apple.com/search"
        params = {
            "term": f"{artist} {album}",
            "media": "music",
            "entity": "album",
            "limit": 1
        }
        resp = requests.get(itunes_url, params=params, timeout=10)
        data = resp.json()
        if data.get("resultCount", 0) > 0:
            return data["results"][0].get("collectionViewUrl", "")
    except Exception as e:
        print(f"Erro ao buscar URL no iTunes: {e}")
    return None

def extrair_variante_hls(hls_url, resolucao_desejada=None):
    """Baixa o manifesto HLS e extrai a URL da melhor variante."""
    try:
        resp = requests.get(hls_url, timeout=10)
        if resp.status_code != 200:
            print(f"Erro ao baixar HLS: {resp.status_code}")
            return None

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
            if iguais:
                return iguais[0][1]

        variantes.sort(key=lambda x: x[0], reverse=True)
        return variantes[0][1]

    except Exception as e:
        print(f"Erro ao processar HLS: {e}")
    return None

def buscar_capa_animada_aritra(artist, album):
    """Busca a capa animada na API do aritra.ovh, priorizando 1080x1080."""
    chave = f"{artist}::{album}".lower()
    if chave in cache_aritra:
        entrada = cache_aritra[chave]
        if time.time() - entrada["timestamp"] < 86400:
            return entrada["video_url"]

    video_url = None

    apple_url = buscar_url_apple_music(artist, album)
    if not apple_url:
        print(f"Não achou URL do Apple Music para {artist} - {album}")
        cache_aritra[chave] = {"video_url": None, "timestamp": time.time()}
        return None

    try:
        resp_covers = requests.get(f"{ARITRA_API}/covers", params={"url": apple_url}, timeout=15)
        if resp_covers.status_code != 200:
            print(f"covers status: {resp_covers.status_code}")
            cache_aritra[chave] = {"video_url": None, "timestamp": time.time()}
            return None

        data_covers = resp_covers.json()
        master = data_covers.get("master", {})
        hls_url = master.get("square") or master.get("tall")

        if not hls_url:
            print(f"covers não retornou master.square: {list(master.keys())}")
            cache_aritra[chave] = {"video_url": None, "timestamp": time.time()}
            return None

        print(f"Manifesto HLS: {hls_url}")

        video_url = extrair_variante_hls(hls_url, "1080x1080")
        if not video_url:
            video_url = extrair_variante_hls(hls_url, "720x720")
        if not video_url:
            video_url = extrair_variante_hls(hls_url, "540x540")
        if not video_url:
            video_url = extrair_variante_hls(hls_url)

        print(f"URL final do vídeo: {video_url}")

    except Exception as e:
        print(f"Erro ao consultar aritra.ovh: {e}")

    cache_aritra[chave] = {"video_url": video_url, "timestamp": time.time()}
    return video_url

def buscar_capa_com_cache(artist, album):
    chave = f"{artist}::{album}".lower()
    if chave in cache_capas:
        entrada = cache_capas[chave]
        if time.time() - entrada["timestamp"] < 300:
            return entrada["static_url"], entrada["video_url"]

    static_url = None
    video_url = None

    if COVERPY_DISPONIVEL and client:
        try:
            results = client.search(f"{artist} {album}", limit=1)
            if results:
                result = results[0]
                static_url = result.artwork(1200)
                motion = client.get_motion_artwork(result)
                if motion:
                    video_url = motion.video_url
        except Exception:
            pass

    if not static_url:
        try:
            itunes_url = "https://itunes.apple.com/search"
            params = {
                "term": f"{artist} {album}",
                "media": "music",
                "entity": "album",
                "limit": 1
            }
            resp = requests.get(itunes_url, params=params, timeout=10)
            data = resp.json()
            if data.get("resultCount", 0) > 0:
                artwork = data["results"][0].get("artworkUrl100", "")
                if artwork:
                    static_url = artwork.replace("100x100", "1200x1200")
        except Exception:
            pass

    cache_capas[chave] = {"static_url": static_url, "video_url": video_url, "timestamp": time.time()}
    return static_url, video_url

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

@app.route('/api/diagnostico')
def diagnostico():
    artist = request.args.get('artist', 'Madonna')
    album = request.args.get('album', 'True Blue')

    resultado = {"artist": artist, "album": album, "passos": {}}

    try:
        itunes_url = "https://itunes.apple.com/search"
        params = {
            "term": f"{artist} {album}",
            "media": "music",
            "entity": "album",
            "limit": 1
        }
        resp = requests.get(itunes_url, params=params, timeout=10)
        data = resp.json()
        if data.get("resultCount", 0) > 0:
            apple_url = data["results"][0].get("collectionViewUrl", "")
            resultado["passos"]["1_apple_url"] = apple_url
        else:
            resultado["passos"]["1_apple_url"] = "NÃO ENCONTRADO"
            return jsonify(resultado)
    except Exception as e:
        resultado["passos"]["1_apple_url"] = f"ERRO: {e}"
        return jsonify(resultado)

    try:
        resp_covers = requests.get(f"{ARITRA_API}/covers", params={"url": apple_url}, timeout=15)
        resultado["passos"]["2_covers_status"] = resp_covers.status_code
        resultado["passos"]["2_covers_resposta"] = resp_covers.text[:500]

        data_covers = resp_covers.json()
        master = data_covers.get("master", {})
        resultado["passos"]["2_master_keys"] = list(master.keys())

        hls_url = master.get("square") or master.get("tall")
        resultado["passos"]["2_hls_url"] = hls_url

        if not hls_url:
            return jsonify(resultado)
    except Exception as e:
        resultado["passos"]["2_covers_erro"] = str(e)
        return jsonify(resultado)

    try:
        video_url = extrair_variante_hls(hls_url, "1080x1080")
        resultado["passos"]["3_video_url_1080"] = video_url
        if not video_url:
            video_url = extrair_variante_hls(hls_url, "720x720")
            resultado["passos"]["3_video_url_720"] = video_url
        if not video_url:
            video_url = extrair_variante_hls(hls_url, "540x540")
            resultado["passos"]["3_video_url_540"] = video_url
        if not video_url:
            video_url = extrair_variante_hls(hls_url)
            resultado["passos"]["3_video_url_maior"] = video_url
    except Exception as e:
        resultado["passos"]["3_erro"] = str(e)
        return jsonify(resultado)

    try:
        if video_url:
            resp_video = requests.head(video_url, timeout=10, allow_redirects=True)
            resultado["passos"]["4_video_status"] = resp_video.status_code
            resultado["passos"]["4_video_content_type"] = resp_video.headers.get('Content-Type', 'desconhecido')
            resultado["passos"]["4_video_size"] = resp_video.headers.get('Content-Length', 'desconhecido')
    except Exception as e:
        resultado["passos"]["4_video_erro"] = str(e)

    return jsonify(resultado)

@app.route('/api/lastfm/now-playing')
def lastfm_now_playing():
    username = request.args.get('user')
    if not username:
        return jsonify({"error": "User parameter is required"}), 400

    lastfm_url = "https://ws.audioscrobbler.com/2.0/"

    params = {
        "method": "user.getrecenttracks",
        "user": username,
        "api_key": LASTFM_API_KEY,
        "format": "json",
        "limit": 1
    }

    try:
        response = None
        for tentativa in range(3):
            try:
                response = requests.get(lastfm_url, params=params, timeout=10)
                if response.status_code == 200:
                    break
                print(f"Tentativa {tentativa + 1} falhou com status {response.status_code}")
                time.sleep(1)
            except requests.RequestException as e:
                print(f"Tentativa {tentativa + 1} falhou: {e}")
                time.sleep(1)

        if not response or response.status_code != 200:
            return jsonify({"error": "Last.fm indisponível no momento. Tente de novo em alguns segundos."}), 503

        data = response.json()

        if "error" in data:
            return jsonify({"error": data.get("message", "Usuário não encontrado")}), 404

        if "recenttracks" not in data:
            return jsonify({"error": "Sem dados recentes"}), 404

        tracks_raw = data["recenttracks"].get("track", [])
        if isinstance(tracks_raw, dict):
            tracks = [tracks_raw]
        else:
            tracks = tracks_raw

        if not tracks:
            return jsonify({"error": "Nenhuma música recente"}), 404

        track = tracks[0]
        artist_name = track.get("artist", {}).get("#text", "")
        track_name = track.get("name", "")
        album_data = track.get("album", {})
        album_name = album_data.get("#text", "") if isinstance(album_data, dict) else ""
        is_now_playing = track.get("@attr", {}).get("nowplaying") == "true"

        lastfm_image = ""
        images = track.get("image", [])
        if images:
            lastfm_image = images[-1].get("#text", "")

        if not track_name or not artist_name:
            return jsonify({"error": "Dados incompletos"}), 404

        if not album_name or not album_name.strip():
            try:
                info_params = {
                    "method": "track.getInfo",
                    "artist": artist_name,
                    "track": track_name,
                    "api_key": LASTFM_API_KEY,
                    "format": "json"
                }
                info_response = requests.get(lastfm_url, params=info_params, timeout=10)
                info_data = info_response.json()
                album_info = info_data.get("track", {}).get("album", {})
                if album_info and album_info.get("title"):
                    album_name = album_info["title"]
            except Exception:
                pass

        video_url = None
        if album_name and album_name.strip():
            video_url = buscar_capa_animada_aritra(artist_name, album_name)

        static_url = None

        if not video_url:
            static_url, video_url_coverpy = buscar_capa_com_cache(artist_name, album_name)
            if video_url_coverpy:
                video_url = video_url_coverpy
        else:
            static_url, _ = buscar_capa_com_cache(artist_name, album_name)

        if not static_url and lastfm_image:
            static_url = lastfm_image

        cor_dominante = {"r": 40, "g": 40, "b": 40}
        if static_url:
            cor_dominante = calcular_cor_dominante(static_url)

        return jsonify({
            "artist": artist_name,
            "track": track_name,
            "album": album_name,
            "is_now_playing": is_now_playing,
            "video_url": video_url,
            "static_url": static_url,
            "dominant_color": cor_dominante
        })

    except requests.RequestException as e:
        return jsonify({"error": f"Erro ao consultar Last.fm: {str(e)}"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000, host='0.0.0.0')
