<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Conversation extends Model
{
    protected $fillable = ['tenant_id','contact_id','channel','status','intent','lead_score','last_customer_message_at','last_agent_message_at','ai_summary'];
    protected $casts = ['last_customer_message_at' => 'datetime','last_agent_message_at' => 'datetime'];
}