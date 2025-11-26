<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Message extends Model
{
    protected $fillable = ['tenant_id','conversation_id','direction','external_message_id','type','body','meta'];
    protected $casts = ['meta' => 'array'];
}