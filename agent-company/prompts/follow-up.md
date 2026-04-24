Write a {{step_label}} follow-up email.

Original email sent to {{business_name}}:
Subject: {{original_subject}}
Body: {{original_body}}

Instructions:
- Reference the original email briefly
- Add a different angle or value point — do not repeat what was already said
- Keep it under 80 words
- This is follow-up {{follow_up_number}} of 3

Output ONLY valid JSON:
{
  "subject": "Re: {{original_subject}}",
  "body": "follow-up email body text"
}
