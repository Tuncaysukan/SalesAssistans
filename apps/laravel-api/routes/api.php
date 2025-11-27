<?php

use Illuminate\Support\Facades\Route;
use App\Http\Controllers\InternalController;
use App\Http\Controllers\ConversationsController;
use App\Http\Controllers\Admin\TenantsController;
use App\Http\Controllers\Admin\UsersController;
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

Route::prefix('admin')->group(function () {
    Route::get('/tenants', [TenantsController::class, 'index']);
    Route::get('/tenants/{id}', [TenantsController::class, 'show']);
    Route::post('/tenants', [TenantsController::class, 'store']);
    Route::put('/tenants/{id}', [TenantsController::class, 'update']);
    Route::delete('/tenants/{id}', [TenantsController::class, 'destroy']);

    Route::get('/users', [UsersController::class, 'index']);
    Route::get('/users/{id}', [UsersController::class, 'show']);
    Route::post('/users', [UsersController::class, 'store']);
    Route::put('/users/{id}', [UsersController::class, 'update']);
    Route::delete('/users/{id}', [UsersController::class, 'destroy']);
});
