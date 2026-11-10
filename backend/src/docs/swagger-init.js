document.addEventListener('DOMContentLoaded', function() {
  if (window.SwaggerUIBundle) {
    window.SwaggerUIBundle({
      url: '/api/docs.json',
      dom_id: '#swagger-ui',
      deepLinking: true
    });
  }
});

