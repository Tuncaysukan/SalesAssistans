<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\Tenant;

class TenantsController extends Controller
{
    public function index()
    {
        $items = Tenant::orderByDesc('id')->paginate(50);
        return response()->json(['ok' => true, 'items' => $items]);
    }

    public function show($id)
    {
        $t = Tenant::find($id);
        if (!$t) return response()->json(['ok' => false], 404);
        return response()->json(['ok' => true, 'item' => $t]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'wa_phone_number_id' => ['nullable','string'],
            'ig_page_id' => ['nullable','string'],
            'wa_config' => ['nullable','array'],
            'ig_config' => ['nullable','array'],
        ]);
        $t = Tenant::create($data);
        return response()->json(['ok' => true, 'item' => $t], 201);
    }

    public function update($id, Request $request)
    {
        $t = Tenant::find($id);
        if (!$t) return response()->json(['ok' => false], 404);
        $data = $request->validate([
            'wa_phone_number_id' => ['nullable','string'],
            'ig_page_id' => ['nullable','string'],
            'wa_config' => ['nullable','array'],
            'ig_config' => ['nullable','array'],
        ]);
        $t->fill($data);
        $t->save();
        return response()->json(['ok' => true, 'item' => $t]);
    }

    public function destroy($id)
    {
        $t = Tenant::find($id);
        if (!$t) return response()->json(['ok' => false], 404);
        $t->delete();
        return response()->json(['ok' => true]);
    }
}

