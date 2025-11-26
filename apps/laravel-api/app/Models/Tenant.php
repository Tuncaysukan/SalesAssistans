<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Tenant extends Model
{
    protected $fillable = ['wa_phone_number_id','ig_page_id','wa_config','ig_config'];
    protected $casts = ['wa_config' => 'array','ig_config' => 'array'];
}