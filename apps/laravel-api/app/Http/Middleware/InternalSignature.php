<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Support\Str;
use Illuminate\Support\Facades\Log;

class InternalSignature
{
    public function handle(Request $request, Closure $next)
    {
        $secret = env('INTERNAL_SECRET');
        if (!$secret) {
            $id = $request->header('X-Trace-Id') ?: Str::random(16);
            $request->headers->set('X-Trace-Id', $id);
            $response = $next($request);
            $response->headers->set('X-Trace-Id', $id);
            return $response;
        }
        if ($request->getMethod() === 'GET') {
            $id = $request->header('X-Trace-Id') ?: Str::random(16);
            $request->headers->set('X-Trace-Id', $id);
            $response = $next($request);
            $response->headers->set('X-Trace-Id', $id);
            return $response;
        }
        $sig = $request->header('X-Internal-Signature');
        if (!$sig) {
            return response()->json(['ok' => false], 401);
        }
        $body = $request->getContent() ?? '';
        $h = hash_hmac('sha256', $body, $secret);
        if (!hash_equals($sig, 'sha256='.$h)) {
            return response()->json(['ok' => false], 401);
        }
        $id = $request->header('X-Trace-Id') ?: Str::random(16);
        $request->headers->set('X-Trace-Id', $id);
        Log::info('req', ['id' => $id, 'path' => $request->path(), 'method' => $request->getMethod()]);
        $response = $next($request);
        $response->headers->set('X-Trace-Id', $id);
        Log::info('res', ['id' => $id, 'status' => $response->getStatusCode()]);
        return $response;
    }
}
