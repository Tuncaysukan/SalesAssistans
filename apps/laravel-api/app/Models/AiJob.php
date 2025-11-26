<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AiJob extends Model
{
    protected $fillable = ['tenant_id','conversation_id','message_id','job_type','input','output','status','cost_tokens'];
    protected $casts = ['input' => 'array','output' => 'array'];
}