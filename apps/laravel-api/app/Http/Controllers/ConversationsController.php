<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Conversation;
use App\Models\Message;

class ConversationsController extends Controller
{
    public function send($id, Request $request)
    {
        $conv = Conversation::find($id);
        if (!$conv) {
            return response()->json(['ok' => false], 404);
        }
        $now = now();
        $within24h = $conv->last_customer_message_at && $now->diffInHours($conv->last_customer_message_at) < 24;
        $type = $within24h ? 'text' : 'template';
        $body = $request->input('text', '');
        Message::create([
            'tenant_id' => $conv->tenant_id,
            'conversation_id' => $conv->id,
            'direction' => 'out',
            'external_message_id' => 'out_'.time(),
            'type' => $type,
            'body' => $body,
            'meta' => [],
        ]);
        $conv->last_agent_message_at = $now;
        $conv->save();
        return response()->json(['ok' => true, 'type' => $type]);
    }
}