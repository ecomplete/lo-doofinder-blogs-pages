const fs = require('fs');

// Configuration
const SHOPIFY_STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN; // e.g., 'latitudes-online.myshopify.com'
const STOREFRONT_ACCESS_TOKEN = process.env.STOREFRONT_ACCESS_TOKEN;
const SITE_URL = 'https://latitudes.online'; // Your public site URL

// GraphQL query for blog articles
const ARTICLES_QUERY = `
  query GetArticles($cursor: String) {
    articles(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          content
          contentHtml
          excerpt
          publishedAt
          image {
            url
            altText
          }
          blog {
            handle
          }
          author {
            name
          }
          tags
        }
      }
    }
  }
`;

// GraphQL query for pages
const PAGES_QUERY = `
  query GetPages($cursor: String) {
    pages(first: 250, after: $cursor) {
      pageInfo {
        hasNextPage
        endCursor
      }
      edges {
        node {
          id
          title
          handle
          body
          bodySummary
          createdAt
          updatedAt
        }
      }
    }
  }
`;

// Fetch data from Shopify Storefront API
async function fetchShopifyData(query, cursor = null) {
  const response = await fetch(`https://${SHOPIFY_STORE_DOMAIN}/api/2024-10/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Storefront-Access-Token': STOREFRONT_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      query,
      variables: { cursor },
    }),
  });

  if (!response.ok) {
    throw new Error(`Shopify API error: ${response.status} ${response.statusText}`);
  }

  return await response.json();
}

// Fetch all articles with pagination
async function fetchAllArticles() {
  let allArticles = [];
  let hasNextPage = true;
  let cursor = null;

  console.log('Fetching blog articles...');
  
  while (hasNextPage) {
    const response = await fetchShopifyData(ARTICLES_QUERY, cursor);
    const { edges, pageInfo } = response.data.articles;
    
    allArticles = allArticles.concat(edges.map(edge => edge.node));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
    
    console.log(`Fetched ${allArticles.length} articles so far...`);
  }

  console.log(`Total articles fetched: ${allArticles.length}`);
  return allArticles;
}

// Fetch all pages with pagination
async function fetchAllPages() {
  let allPages = [];
  let hasNextPage = true;
  let cursor = null;

  console.log('Fetching CMS pages...');
  
  while (hasNextPage) {
    const response = await fetchShopifyData(PAGES_QUERY, cursor);
    const { edges, pageInfo } = response.data.pages;
    
    allPages = allPages.concat(edges.map(edge => edge.node));
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
    
    console.log(`Fetched ${allPages.length} pages so far...`);
  }

  console.log(`Total pages fetched: ${allPages.length}`);
  return allPages;
}

// Clean HTML content for XML
function cleanContent(html) {
  if (!html) return '';
  
  // Remove HTML tags and decode entities
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// Escape XML special characters
function escapeXml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Generate XML feed
function generateXML(articles, pages) {
  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">\n';
  xml += '  <channel>\n';
  xml += `    <title>Latitudes Online Content Feed</title>\n`;
  xml += `    <link>${SITE_URL}</link>\n`;
  xml += `    <description>Blog articles and CMS pages for Doofinder</description>\n\n`;

  // Add blog articles
  articles.forEach(article => {
    const url = `${SITE_URL}/blogs/${article.blog.handle}/${article.handle}`;
    const description = cleanContent(article.excerpt || article.contentHtml);
    const imageUrl = article.image?.url || '';

    xml += '    <item>\n';
    xml += `      <g:id>blog_${article.handle}</g:id>\n`;
    xml += `      <title>${escapeXml(article.title)}</title>\n`;
    xml += `      <link>${escapeXml(url)}</link>\n`;
    xml += `      <description>${escapeXml(description)}</description>\n`;
    xml += `      <g:type>blog_article</g:type>\n`;
    
    if (imageUrl) {
      xml += `      <g:image_link>${escapeXml(imageUrl)}</g:image_link>\n`;
    }
    
    if (article.publishedAt) {
      xml += `      <pubDate>${new Date(article.publishedAt).toUTCString()}</pubDate>\n`;
    }
    
    if (article.author?.name) {
      xml += `      <author>${escapeXml(article.author.name)}</author>\n`;
    }
    
    if (article.tags && article.tags.length > 0) {
      article.tags.forEach(tag => {
        xml += `      <category>${escapeXml(tag)}</category>\n`;
      });
    }
    
    xml += '    </item>\n\n';
  });

  // Add CMS pages
  pages.forEach(page => {
    const url = `${SITE_URL}/pages/${page.handle}`;
    const description = cleanContent(page.bodySummary || page.body);

    xml += '    <item>\n';
    xml += `      <g:id>page_${page.handle}</g:id>\n`;
    xml += `      <title>${escapeXml(page.title)}</title>\n`;
    xml += `      <link>${escapeXml(url)}</link>\n`;
    xml += `      <description>${escapeXml(description)}</description>\n`;
    xml += `      <g:type>cms_page</g:type>\n`;
    
    if (page.updatedAt) {
      xml += `      <pubDate>${new Date(page.updatedAt).toUTCString()}</pubDate>\n`;
    }
    
    xml += '    </item>\n\n';
  });

  xml += '  </channel>\n';
  xml += '</rss>';

  return xml;
}

// Main function
async function main() {
  try {
    console.log('Starting feed generation...\n');

    // Validate environment variables
    if (!SHOPIFY_STORE_DOMAIN || !STOREFRONT_ACCESS_TOKEN) {
      throw new Error('Missing required environment variables: SHOPIFY_STORE_DOMAIN and STOREFRONT_ACCESS_TOKEN');
    }

    // Fetch data
    const articles = await fetchAllArticles();
    const pages = await fetchAllPages();

    console.log(`\nGenerating XML feed...`);
    const xml = generateXML(articles, pages);

    // Write to file
    const outputPath = 'doofinder-content-feed.xml';
    fs.writeFileSync(outputPath, xml);

    console.log(`\n✅ Feed generated successfully!`);
    console.log(`   File: ${outputPath}`);
    console.log(`   Total items: ${articles.length + pages.length} (${articles.length} articles, ${pages.length} pages)`);
    console.log(`   File size: ${(fs.statSync(outputPath).size / 1024 / 1024).toFixed(2)} MB`);

  } catch (error) {
    console.error('❌ Error generating feed:', error.message);
    process.exit(1);
  }
}

main();