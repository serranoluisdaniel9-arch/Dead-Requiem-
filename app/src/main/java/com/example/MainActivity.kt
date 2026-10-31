package com.example

import android.annotation.SuppressLint
import android.content.res.AssetManager
import android.os.Bundle
import android.util.Log
import android.view.KeyEvent
import android.view.View
import android.view.WindowManager
import android.webkit.ConsoleMessage
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.io.IOException

class MainActivity : ComponentActivity() {

    companion object {
        private const val TAG = "DeadStrikeReborn"
        private const val ASSET_HOST = "appassets.androidplatform.net"
        private const val ASSET_PREFIX = "/assets/"
        private const val START_URL = "https://$ASSET_HOST${ASSET_PREFIX}index.html?touch=1"
    }

    private var webView: WebView? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Keep screen on for continuous gameplay and configure immersive edge-to-edge
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemUi()

        val web = WebView(this)
        webView = web
        setContentView(web)

        // Force hardware layer for maximum 60 FPS WebGL performance
        web.setLayerType(View.LAYER_TYPE_HARDWARE, null)

        val settings = web.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.mediaPlaybackRequiresUserGesture = false
        settings.setSupportZoom(false)
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        settings.cacheMode = WebSettings.LOAD_DEFAULT

        web.setBackgroundColor(0xFF060A0C.toInt())
        web.overScrollMode = View.OVER_SCROLL_NEVER
        web.isVerticalScrollBarEnabled = false
        web.isHorizontalScrollBarEnabled = false
        web.isFocusable = true
        web.isFocusableInTouchMode = true
        web.requestFocus()

        web.webChromeClient = object : WebChromeClient() {
            override fun onConsoleMessage(consoleMessage: ConsoleMessage?): Boolean {
                consoleMessage?.let {
                    Log.d(
                        TAG,
                        "[JS ${it.messageLevel()}]: ${it.message()} -- line ${it.lineNumber()} of ${it.sourceId()}"
                    )
                }
                return true
            }
        }

        web.webViewClient = GameAssetClient(assets)
        web.loadUrl(START_URL)
    }

    private fun hideSystemUi() {
        val windowInsetsController = WindowCompat.getInsetsController(window, window.decorView)
        windowInsetsController.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        windowInsetsController.hide(WindowInsetsCompat.Type.systemBars())
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            hideSystemUi()
        }
    }

    override fun onKeyDown(keyCode: Int, event: KeyEvent?): Boolean {
        if (keyCode == KeyEvent.KEYCODE_BACK) {
            // Forward back button to the game engine as an Escape event
            // so pause, refuge, and modals dismiss gracefully without exiting.
            webView?.evaluateJavascript(
                "(function(){try{window.dispatchEvent(new KeyboardEvent('keydown',{code:'Escape'}));}catch(e){}})();",
                null
            )
            return true
        }
        return super.onKeyDown(keyCode, event)
    }

    override fun onPause() {
        super.onPause()
        webView?.onPause()
    }

    override fun onResume() {
        super.onResume()
        webView?.onResume()
        hideSystemUi()
    }

    override fun onDestroy() {
        webView?.let {
            it.destroy()
            webView = null
        }
        super.onDestroy()
    }

    private class GameAssetClient(private val assetManager: AssetManager) : WebViewClient() {
        override fun shouldInterceptRequest(
            view: WebView?,
            request: WebResourceRequest?
        ): WebResourceResponse? {
            val url = request?.url ?: return null
            val host = url.host
            val path = url.path
            if (ASSET_HOST == host && path != null && path.startsWith(ASSET_PREFIX)) {
                val assetPath = path.substring(ASSET_PREFIX.length)
                val headers = mutableMapOf(
                    "Access-Control-Allow-Origin" to "*",
                    "Access-Control-Allow-Methods" to "GET, OPTIONS, HEAD",
                    "Access-Control-Allow-Headers" to "*",
                    "Cache-Control" to "no-cache"
                )
                if (request.method.equals("OPTIONS", ignoreCase = true)) {
                    return WebResourceResponse("text/plain", "utf-8", 200, "OK", headers, null)
                }
                return try {
                    val stream = assetManager.open(assetPath)
                    val mime = mimeFor(assetPath)
                    WebResourceResponse(mime, "utf-8", 200, "OK", headers, stream)
                } catch (e: IOException) {
                    Log.e(TAG, "Missing asset: $assetPath", e)
                    WebResourceResponse("text/plain", "utf-8", 404, "Not Found", headers, null)
                }
            }
            return WebResourceResponse("text/plain", "utf-8", null)
        }

        override fun shouldOverrideUrlLoading(
            view: WebView?,
            request: WebResourceRequest?
        ): Boolean {
            val host = request?.url?.host
            return ASSET_HOST != host
        }

        private fun mimeFor(path: String): String {
            return when {
                path.endsWith(".html") -> "text/html"
                path.endsWith(".js") || path.endsWith(".mjs") -> "text/javascript"
                path.endsWith(".css") -> "text/css"
                path.endsWith(".svg") -> "image/svg+xml"
                path.endsWith(".png") -> "image/png"
                path.endsWith(".jpg") || path.endsWith(".jpeg") -> "image/jpeg"
                path.endsWith(".json") -> "application/json"
                path.endsWith(".wasm") -> "application/wasm"
                path.endsWith(".woff") -> "font/woff"
                path.endsWith(".woff2") -> "font/woff2"
                else -> "application/octet-stream"
            }
        }
    }
}
