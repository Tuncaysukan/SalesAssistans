<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;

class InternalSignature
{
    public function handle(Request $request, Closure $next)
    {
        $secret = env('INTERNAL_SECRET');
        if (!$secret) {
            return $next($request);
        }
        if ($request->getMethod() === 'GET') {
            return $next($request);
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
        return $next($request);
    }
}
