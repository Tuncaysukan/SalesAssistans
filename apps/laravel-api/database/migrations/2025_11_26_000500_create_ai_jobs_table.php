<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('ai_jobs', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->nullable()->constrained('tenants');
            $table->foreignId('conversation_id')->nullable()->constrained('conversations');
            $table->foreignId('message_id')->nullable()->constrained('messages');
            $table->string('job_type');
            $table->json('input')->nullable();
            $table->json('output')->nullable();
            $table->string('status')->default('queued');
            $table->integer('cost_tokens')->nullable();
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('ai_jobs');
    }
};