<?php
// send-email.php - Email sending endpoint
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST');
header('Access-Control-Allow-Headers: Content-Type');

// Only accept POST requests
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    echo json_encode(['error' => 'Only POST method allowed']);
    exit;
}

// Get the request data
$input = file_get_contents('php://input');
$data = json_decode($input, true);

if (!$data) {
    echo json_encode(['error' => 'Invalid JSON data']);
    exit;
}

$email = isset($data['email']) ? $data['email'] : '';
$code = isset($data['code']) ? $data['code'] : '';

if (empty($email) || empty($code)) {
    echo json_encode(['error' => 'Email and code are required']);
    exit;
}

// Email settings
$subject = "ChatMate Email Verification";
$verification_code = $code;

// HTML Email Template
$html_content = "
<!DOCTYPE html>
<html>
<head>
    <meta charset='UTF-8'>
    <title>ChatMate Verification</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .container {
            max-width: 600px;
            margin: 20px auto;
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            color: white;
            margin: 0;
            font-size: 28px;
        }
        .content {
            padding: 30px;
        }
        .code {
            background: #f5f5f5;
            padding: 20px;
            text-align: center;
            margin: 20px 0;
            border-radius: 10px;
        }
        .code span {
            font-size: 32px;
            font-weight: bold;
            letter-spacing: 5px;
            color: #667eea;
        }
        .footer {
            background: #f9f9f9;
            padding: 20px;
            text-align: center;
            font-size: 12px;
            color: #999;
        }
        .button {
            display: inline-block;
            padding: 12px 24px;
            background: #667eea;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 15px;
        }
    </style>
</head>
<body>
    <div class='container'>
        <div class='header'>
            <h1>ChatMate</h1>
        </div>
        <div class='content'>
            <h2>Verify Your Email Address</h2>
            <p>Thank you for signing up for ChatMate! Please use the verification code below to complete your registration.</p>
            <div class='code'>
                <span>{$verification_code}</span>
            </div>
            <p>This code will expire in <strong>10 minutes</strong>.</p>
            <p>If you didn't request this, please ignore this email.</p>
        </div>
        <div class='footer'>
            <p>&copy; 2024 ChatMate. All rights reserved.</p>
            <p>This is an automated message, please do not reply.</p>
        </div>
    </div>
</body>
</html>
";

// Plain text version
$text_content = "ChatMate Email Verification\n\n";
$text_content .= "Your verification code is: {$verification_code}\n";
$text_content .= "This code expires in 10 minutes.\n";
$text_content .= "If you didn't request this, please ignore this email.\n";

// Headers for HTML email
$headers = "MIME-Version: 1.0\r\n";
$headers .= "Content-Type: text/html; charset=UTF-8\r\n";
$headers .= "From: ChatMate <noreply@chatmate.local>\r\n";
$headers .= "Reply-To: support@chatmate.local\r\n";

// Try to send email
$success = mail($email, $subject, $html_content, $headers);

if ($success) {
    echo json_encode([
        'success' => true, 
        'message' => 'Verification email sent successfully',
        'email' => $email
    ]);
} else {
    // Log error for debugging
    error_log("Failed to send email to: $email");
    echo json_encode([
        'error' => 'Failed to send email. Please check server configuration.',
        'details' => 'Mail function returned false'
    ]);
}
?>