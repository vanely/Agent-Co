You are researching a business to write a personalized cold email.

Business details:
- Name: {{business_name}}
- Website: {{website}}
- Category: {{category}}
- Location: {{city}}, {{state}}
- Contact: {{owner_name}}
- Rating: {{average_rating}} ({{total_reviews}} reviews)

Instructions:
1. If a website URL is available, use your web access to visit it and understand what they do.
2. Identify one specific and concrete pain point this type of business commonly faces.
3. Write a short cold email that addresses that pain point directly.
4. Keep the email under 150 words. Be specific, not generic.

Output ONLY valid JSON with no markdown, no code fences, no explanation outside the JSON:
{
  "subject": "email subject line",
  "body": "email body text (plain text, no HTML)",
  "pain_point": "one sentence describing the pain point addressed",
  "reasoning": "why this angle was chosen"
}
