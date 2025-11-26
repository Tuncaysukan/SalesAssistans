<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\InternalController;
use App\Http\Controllers\ConversationsController;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Redis;

Route::middleware('internal')->group(function () {
    Route::post('/internal/ingest', [InternalController::class, 'ingest']);
    Route::post('/internal/intent', [InternalController::class, 'intent']);
    Route::post('/internal/ai/classified', [InternalController::class, 'classified']);
    Route::post('/internal/ai/draft', [InternalController::class, 'draft']);
    Route::get('/internal/conversations', [InternalController::class, 'list']);
    Route::get('/internal/conversations/{id}', [InternalController::class, 'conversation']);
    Route::post('/internal/followup/overdue', [InternalController::class, 'overdue']);
});

Route::post('/conversations/{id}/send', [ConversationsController::class, 'send']);

Route::get('/health/laravel', function () {
    $db = false; $redis = false;
    try { DB::select('select 1'); $db = true; } catch (\Throwable $e) { $db = false; }
    try { Redis::connection()->client()->ping(); $redis = true; } catch (\Throwable $e) { $redis = false; }
    return response()->json(['ok' => true, 'db' => $db, 'redis' => $redis, 'ts' => now()->timestamp]);
});

Route::get('/debug/error', function () {
    throw new \Exception('debug error');
});
