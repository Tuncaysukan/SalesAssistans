<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained('tenants');
            $table->foreignId('contact_id')->constrained('contacts');
            $table->string('channel');
            $table->string('status')->default('new');
            $table->string('intent')->nullable();
            $table->decimal('lead_score', 5, 2)->nullable();
            $table->timestamp('last_customer_message_at')->nullable();
            $table->timestamp('last_agent_message_at')->nullable();
            $table->text('ai_summary')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id','contact_id','channel']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('conversations');
    }
};