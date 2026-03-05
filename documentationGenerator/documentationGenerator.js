const fs = require('fs');
const path = require('path');
const axios = require('axios');

function getLlmConfig() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  const baseUrl = process.env.OPENAI_BASE_URL || process.env.LLM_BASE_URL || 'http://localhost:11434';
  const chatModel = process.env.LLM_CHAT_MODEL || 'minimax-m2.5:cloud';
  
  const isOllama = baseUrl.includes('localhost:11434') || baseUrl.includes('ollama');
  
  return {
    enabled: true,
    apiKey: apiKey || 'dummy',
    baseUrl,
    chatModel,
    provider: isOllama ? 'ollama' : (process.env.LLM_PROVIDER || 'openai-compatible'),
    isOllama
  };
}

function getLlmHttpClient(config) {
  const clientConfig = {
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json'
    },
    timeout: 120000
  };
  
  if (!config.isOllama && config.apiKey && config.apiKey !== 'dummy') {
    clientConfig.headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  
  return axios.create(clientConfig);
}

async function analyzeCodeWithLLM(code, filePath) {
  const config = getLlmConfig();
  const client = getLlmHttpClient(config);
  
  const prompt = `Analyze the following code and generate comprehensive documentation.

Return a JSON object with this structure:
{
  "summary": "Brief one-line description",
  "description": "Detailed explanation of what this code does",
  "functions": [
    {
      "name": "function name",
      "description": "what it does",
      "parameters": [
        {
          "name": "param name",
          "type": "type",
          "description": "param description",
          "optional": boolean
        }
      ],
      "returns": {
        "type": "return type",
        "description": "what it returns"
      },
      "examples": ["example usage"]
    }
  ],
  "classes": [
    {
      "name": "class name",
      "description": "class purpose",
      "methods": ["method names"]
    }
  ],
  "dependencies": ["list of imports/dependencies"],
  "usage": "how to use this code",
  "notes": ["important notes or caveats"]
}

File: ${filePath}

Code:
\`\`\`
${code}
\`\`\`

Constraints:
- Return valid JSON only, no markdown
- Be thorough and accurate
- Include all public functions and classes
- Provide practical examples
- Mention any edge cases or important behaviors`;

  let response;
  
  if (config.isOllama) {
    response = await client.post('/api/chat', {
      model: config.chatModel,
      temperature: 0.3,
      messages: [
        { role: 'system', content: 'You are a technical documentation writer. Always respond with valid JSON only.' },
        { role: 'user', content: prompt }
      ],
      stream: false
    });
    
    const content = response.data?.message?.content;
    if (!content) {
      return null;
    }
    
    try {
      const cleaned = content.replace(/^```(?:json)?\n?/g, '').replace(/```$/g, '').trim();
      return JSON.parse(cleaned);
    } catch (e) {
      return null;
    }
  }
  
  response = await client.post('/chat/completions', {
    model: config.chatModel,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'You are a technical documentation writer. Always respond with valid JSON only.' },
      { role: 'user', content: prompt }
    ]
  });

  const content = response.data?.choices?.[0]?.message?.content;
  if (!content) {
    return null;
  }

  try {
    return JSON.parse(content);
  } catch (e) {
    return null;
  }
}

function formatMarkdown(docs, filePath) {
  let markdown = `# ${path.basename(filePath)}\n\n`;
  
  if (docs.summary) {
    markdown += `**${docs.summary}**\n\n`;
  }
  
  if (docs.description) {
    markdown += `## Overview\n\n${docs.description}\n\n`;
  }
  
  if (docs.functions && docs.functions.length > 0) {
    markdown += `## Functions\n\n`;
    
    for (const func of docs.functions) {
      markdown += `### ${func.name}\n\n`;
      markdown += `${func.description}\n\n`;
      
      if (func.parameters && func.parameters.length > 0) {
        markdown += `**Parameters:**\n\n`;
        for (const param of func.parameters) {
          const optional = param.optional ? ' (optional)' : '';
          markdown += `- \`${param.name}\` (${param.type || 'any'})${optional}: ${param.description}\n`;
        }
        markdown += '\n';
      }
      
      if (func.returns) {
        markdown += `**Returns:** ${func.returns.type || 'any'} - ${func.returns.description}\n\n`;
      }
      
      if (func.examples && func.examples.length > 0) {
        markdown += `**Examples:**\n\n\`\`\`javascript\n${func.examples.join('\n\n')}\n\`\`\`\n\n`;
      }
    }
  }
  
  if (docs.classes && docs.classes.length > 0) {
    markdown += `## Classes\n\n`;
    
    for (const cls of docs.classes) {
      markdown += `### ${cls.name}\n\n`;
      markdown += `${cls.description}\n\n`;
      
      if (cls.methods && cls.methods.length > 0) {
        markdown += `**Methods:** ${cls.methods.map(m => `\`${m}\``).join(', ')}\n\n`;
      }
    }
  }
  
  if (docs.dependencies && docs.dependencies.length > 0) {
    markdown += `## Dependencies\n\n`;
    for (const dep of docs.dependencies) {
      markdown += `- ${dep}\n`;
    }
    markdown += '\n';
  }
  
  if (docs.usage) {
    markdown += `## Usage\n\n${docs.usage}\n\n`;
  }
  
  if (docs.notes && docs.notes.length > 0) {
    markdown += `## Notes\n\n`;
    for (const note of docs.notes) {
      markdown += `- ${note}\n`;
    }
    markdown += '\n';
  }
  
  return markdown;
}

function formatJsdoc(docs) {
  let jsdoc = '';
  
  if (docs.functions) {
    for (const func of docs.functions) {
      jsdoc += '/**\n';
      jsdoc += ` * ${func.description}\n`;
      
      if (func.parameters) {
        for (const param of func.parameters) {
          jsdoc += ` * @param {${param.type || '*'}} ${param.name} - ${param.description}\n`;
        }
      }
      
      if (func.returns) {
        jsdoc += ` * @returns {${func.returns.type || '*'}} ${func.returns.description}\n`;
      }
      
      jsdoc += ' */\n';
    }
  }
  
  return jsdoc;
}

async function generateDocumentation(filePath, options = {}) {
  try {
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    
    if (!fs.existsSync(absolutePath)) {
      return {
        success: false,
        error: `File not found: ${filePath}`
      };
    }
    
    const code = fs.readFileSync(absolutePath, 'utf-8');
    const docs = await analyzeCodeWithLLM(code, filePath);
    
    if (!docs) {
      return {
        success: false,
        error: 'Failed to generate documentation with LLM'
      };
    }
    
    const format = options.format || 'markdown';
    let output;
    
    if (format === 'markdown') {
      output = formatMarkdown(docs, filePath);
    } else if (format === 'jsdoc') {
      output = formatJsdoc(docs);
    } else if (format === 'json') {
      output = JSON.stringify(docs, null, 2);
    }
    
    if (options.outputPath) {
      const outPath = path.isAbsolute(options.outputPath) 
        ? options.outputPath 
        : path.join(process.cwd(), options.outputPath);
      fs.writeFileSync(outPath, output, 'utf-8');
    }
    
    return {
      success: true,
      format,
      documentation: output,
      docs,
      sourceFile: filePath
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function generateDocumentationForDir(dirPath, options = {}) {
  try {
    const absoluteDir = path.isAbsolute(dirPath) ? dirPath : path.join(process.cwd(), dirPath);
    
    if (!fs.existsSync(absoluteDir)) {
      return {
        success: false,
        error: `Directory not found: ${dirPath}`
      };
    }
    
    const extensions = options.extensions || ['.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.cs'];
    const exclude = options.exclude || ['node_modules', '.git', 'dist', 'build'];
    
    const results = [];
    
    async function walkDir(dir) {
      const files = fs.readdirSync(dir);
      
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
          if (!exclude.includes(file)) {
            await walkDir(fullPath);
          }
        } else if (stat.isFile()) {
          const ext = path.extname(file);
          if (extensions.includes(ext)) {
            const relativePath = path.relative(absoluteDir, fullPath);
            const result = await generateDocumentation(fullPath, {
              ...options,
              outputPath: options.outputDir 
                ? path.join(options.outputDir, relativePath.replace(ext, '.md'))
                : undefined
            });
            results.push({
              file: relativePath,
              ...result
            });
          }
        }
      }
    }
    
    await walkDir(absoluteDir);
    
    const successful = results.filter(r => r.success).length;
    
    return {
      success: true,
      totalFiles: results.length,
      successful,
      failed: results.length - successful,
      results
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = { 
  generateDocumentation,
  generateDocumentationForDir,
  analyzeCodeWithLLM
};