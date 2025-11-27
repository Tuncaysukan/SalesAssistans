<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Models\User;

class UsersController extends Controller
{
    public function index(Request $request)
    {
        $tenantId = $request->query('tenant_id');
        $q = User::query();
        if ($tenantId) $q->where('tenant_id', $tenantId);
        $items = $q->orderByDesc('id')->paginate(50);
        return response()->json(['ok' => true, 'items' => $items]);
    }

    public function show($id)
    {
        $u = User::find($id);
        if (!$u) return response()->json(['ok' => false], 404);
        return response()->json(['ok' => true, 'item' => $u]);
    }

    public function store(Request $request)
    {
        $data = $request->validate([
            'name' => ['required','string'],
            'email' => ['required','email','unique:users,email'],
            'password' => ['required','string','min:6'],
            'role' => ['nullable','string'],
            'tenant_id' => ['nullable','integer']
        ]);
        $u = new User();
        $u->name = $data['name'];
        $u->email = $data['email'];
        $u->password = $data['password'];
        if (isset($data['role'])) $u->role = $data['role'];
        if (isset($data['tenant_id'])) $u->tenant_id = $data['tenant_id'];
        $u->save();
        return response()->json(['ok' => true, 'item' => $u], 201);
    }

    public function update($id, Request $request)
    {
        $u = User::find($id);
        if (!$u) return response()->json(['ok' => false], 404);
        $data = $request->validate([
            'name' => ['nullable','string'],
            'email' => ['nullable','email','unique:users,email,'.$u->id],
            'password' => ['nullable','string','min:6'],
            'role' => ['nullable','string'],
            'tenant_id' => ['nullable','integer']
        ]);
        foreach (['name','email','role','tenant_id'] as $k) {
            if (array_key_exists($k, $data)) $u->$k = $data[$k];
        }
        if (array_key_exists('password', $data)) $u->password = $data['password'];
        $u->save();
        return response()->json(['ok' => true, 'item' => $u]);
    }

    public function destroy($id)
    {
        $u = User::find($id);
        if (!$u) return response()->json(['ok' => false], 404);
        $u->delete();
        return response()->json(['ok' => true]);
    }
}

