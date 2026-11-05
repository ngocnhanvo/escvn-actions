<?php
/**
 * Plugin Name: ESC HKD Route Sync (One Time)
 * Description: Admin-only temporary reconciliation of one verified routing event.
 */
if (!defined('ABSPATH')) { exit; }

add_action('admin_menu', static function () {
    add_management_page('HKD Route Sync', 'HKD Route Sync', 'manage_options', 'esc-hkd-route-sync-once', 'esc_hkd_route_sync_once_page');
});

function esc_hkd_route_sync_once_page() {
    if (!current_user_can('manage_options')) { wp_die('Forbidden', '', array('response' => 403)); }
    $post = get_post(55522);
    $valid = $post && $post->post_type === 'chuyen-huong-link' && $post->post_status === 'publish'
        && (string) get_post_meta(55522, 'from_link', true) === '/ban-do-ho-kinh-doanh'
        && (string) get_post_meta(55522, 'to_link', true) === '/ban-do-ho-kinh-doanh/index.html'
        && (string) get_post_meta(55522, 'type', true) === 'Rewrite'
        && (string) get_post_meta(55522, 'match_type', true) === 'Exact'
        && !empty(get_post_meta(55522, 'enable', true))
        && function_exists('vcs_write_universal_log');
    echo '<div class="wrap"><h1>HKD route — one-time reconciliation</h1>';
    if (isset($_POST['esc_hkd_sync_once'])) {
        check_admin_referer('esc_hkd_sync_once');
        if (!$valid) {
            wp_die('Unexpected route state; no changes made', '', array('response' => 409));
        }
        vcs_write_universal_log(55522, 'chuyen-huong-link', 'modify');
        echo '<div class="notice notice-success"><p id="esc-hkd-sync-success">Event recorded for route #55522</p></div>';
    }
    if ($valid) {
        echo '<p>Verified exact published /ban-do-ho-kinh-doanh → /ban-do-ho-kinh-doanh/index.html rewrite.</p>';
        echo '<form method="post">';
        wp_nonce_field('esc_hkd_sync_once');
        echo '<button class="button button-primary" name="esc_hkd_sync_once" value="1" type="submit">Record routing event</button>';
        echo '</form>';
    } else {
        echo '<p>Route or source logging function unavailable; no writes permitted.</p>';
    }
    echo '</div>';
}
