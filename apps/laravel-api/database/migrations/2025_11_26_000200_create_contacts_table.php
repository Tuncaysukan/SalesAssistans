<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('contacts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('tenant_id')->constrained('tenants');
            $table->string('channel');
            $table->string('external_contact_id');
            $table->json('tags')->nullable();
            $table->timestamps();
            $table->unique(['tenant_id','external_contact_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('contacts');
    }
};