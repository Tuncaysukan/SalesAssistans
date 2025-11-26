<?php

namespace Database\Seeders;

use App\Models\User;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;
use App\Models\Tenant;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(): void
    {
        $wa = env('WA_PHONE_NUMBER_ID');
        $ig = env('IG_PAGE_ID');
        if ($wa || $ig) {
            Tenant::firstOrCreate([
                'wa_phone_number_id' => $wa,
                'ig_page_id' => $ig,
            ], [
                'wa_config' => ['templates' => ['followup' => ['name' => 'followup_1']]],
                'ig_config' => [],
            ]);
        }
    }
}
