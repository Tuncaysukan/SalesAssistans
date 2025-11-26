<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class Contact extends Model
{
    protected $fillable = ['tenant_id','channel','external_contact_id','tags'];
    protected $casts = ['tags' => 'array'];
}