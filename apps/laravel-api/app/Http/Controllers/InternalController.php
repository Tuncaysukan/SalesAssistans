<?php

namespace App\Http\Controllers;

use Illuminate\Http\Request;
use App\Models\Tenant;
use App\Models\Contact;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\AiJob;

class InternalController extends Controller
{
    public function ingest(Request $request)
    {
        $payload = $request->all();
        $tenantKey = $payload['tenant_key'] ?? null;
        $tenant = Tenant::where('wa_phone_number_id', $tenantKey)->orWhere('ig_page_id', $tenantKey)->first();
        if (!$tenant) {
            return response()->json(['ok' => true, 'status' => 'unknown_tenant']);
        }
        $contact = Contact::firstOrCreate([
            'tenant_id' => $tenant->id,
            'external_contact_id' => $payload['external_contact_id'] ?? '',
        ], [
            'channel' => $payload['channel'] ?? 'wa',
        ]);
        $conversation = Conversation::firstOrCreate([
            'tenant_id' => $tenant->id,
            'contact_id' => $contact->id,
            'channel' => $payload['channel'] ?? 'wa',
        ], [
            'status' => 'new',
        ]);
        $exists = Message::where('external_message_id', $payload['external_message_id'] ?? '')->exists();
        if (!$exists) {
            Message::create([
                'tenant_id' => $tenant->id,
                'conversation_id' => $conversation->id,
                'direction' => $payload['direction'] ?? 'in',
                'external_message_id' => $payload['external_message_id'] ?? '',
                'type' => $payload['type'] ?? 'text',
                'body' => $payload['body'] ?? '',
                'meta' => $payload['meta'] ?? [],
            ]);
            if (($payload['direction'] ?? 'in') === 'in') {
                $conversation->last_customer_message_at = now();
                $conversation->save();
            }
        }
        return response()->json(['ok' => true, 'conversation_id' => $conversation->id]);
    }

    public function intent(Request $request)
    {
        $payload = $request->all();
        $convId = Message::where('external_message_id', $payload['external_message_id'] ?? '')->value('conversation_id');
        if (!$convId) {
            return response()->json(['ok' => true, 'status' => 'message_not_found']);
        }
        $conv = Conversation::find($convId);
        $conv->intent = $payload['intent'] ?? $conv->intent;
        $conv->lead_score = $payload['lead_score'] ?? $conv->lead_score;
        $conv->save();
        return response()->json(['ok' => true]);
    }

    public function classified(Request $request)
    {
        $payload = $request->all();
        $convId = Message::where('external_message_id', $payload['external_message_id'] ?? '')->value('conversation_id');
        if ($convId) {
            $conv = Conversation::find($convId);
            $conv->intent = $payload['intent'] ?? $conv->intent;
            $conv->lead_score = $payload['confidence'] ?? $conv->lead_score;
            $conv->status = 'qualified';
            $conv->save();
            AiJob::create([
                'tenant_id' => $conv->tenant_id,
                'conversation_id' => $conv->id,
                'message_id' => null,
                'job_type' => 'classified',
                'input' => [],
                'output' => $payload,
                'status' => 'done',
                'cost_tokens' => null,
            ]);
        }
        return response()->json(['ok' => true]);
    }

    public function draft(Request $request)
    {
        $payload = $request->all();
        AiJob::create([
            'tenant_id' => null,
            'conversation_id' => null,
            'message_id' => null,
            'job_type' => 'draft',
            'input' => [],
            'output' => $payload,
            'status' => 'done',
            'cost_tokens' => null,
        ]);
        return response()->json(['ok' => true]);
    }

    public function conversation($id)
    {
        $conv = Conversation::find($id);
        if (!$conv) return response()->json(['ok' => false], 404);
        return response()->json(['ok' => true, 'conversation' => $conv]);
    }

    public function list()
    {
        $convs = Conversation::orderByDesc('id')->limit(50)->get(['id','status','intent','tenant_id','contact_id','channel','last_customer_message_at','last_agent_message_at','overdue']);
        return response()->json(['ok' => true, 'conversations' => $convs]);
    }

    public function overdue(Request $request)
    {
        $id = $request->input('conversation_id');
        $conv = Conversation::find($id);
        if (!$conv) return response()->json(['ok' => false], 404);
        $conv->overdue = true;
        $conv->save();
        return response()->json(['ok' => true]);
    }
}
