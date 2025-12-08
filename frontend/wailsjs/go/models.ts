export namespace main {
	
	export class ChatMessage {
	    role: string;
	    content: string;
	
	    static createFrom(source: any = {}) {
	        return new ChatMessage(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.role = source["role"];
	        this.content = source["content"];
	    }
	}
	export class ChatRequest {
	    sessionId: string;
	    provider: string;
	    endpoint: string;
	    apiKey: string;
	    model: string;
	    message: string;
	    history: ChatMessage[];
	    tools: string[];
	    chatOnly: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ChatRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.sessionId = source["sessionId"];
	        this.provider = source["provider"];
	        this.endpoint = source["endpoint"];
	        this.apiKey = source["apiKey"];
	        this.model = source["model"];
	        this.message = source["message"];
	        this.history = this.convertValues(source["history"], ChatMessage);
	        this.tools = source["tools"];
	        this.chatOnly = source["chatOnly"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class DialogueTrace {
	    id: string;
	    role: string;
	    kind: string;
	    title?: string;
	    content: string;
	    status?: string;
	    // Go type: time
	    createdAt: any;
	
	    static createFrom(source: any = {}) {
	        return new DialogueTrace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.role = source["role"];
	        this.kind = source["kind"];
	        this.title = source["title"];
	        this.content = source["content"];
	        this.status = source["status"];
	        this.createdAt = this.convertValues(source["createdAt"], null);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ChatResponse {
	    message: ChatMessage;
	    latencyMs: number;
	    trace: DialogueTrace[];
	
	    static createFrom(source: any = {}) {
	        return new ChatResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.message = this.convertValues(source["message"], ChatMessage);
	        this.latencyMs = source["latencyMs"];
	        this.trace = this.convertValues(source["trace"], DialogueTrace);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	export class ModelsRequest {
	    provider: string;
	    endpoint: string;
	    apiKey: string;
	
	    static createFrom(source: any = {}) {
	        return new ModelsRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.provider = source["provider"];
	        this.endpoint = source["endpoint"];
	        this.apiKey = source["apiKey"];
	    }
	}
	export class ModelsResponse {
	    models: string[];
	
	    static createFrom(source: any = {}) {
	        return new ModelsResponse(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.models = source["models"];
	    }
	}
	export class SetToolEnabledRequest {
	    id: string;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SetToolEnabledRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.enabled = source["enabled"];
	    }
	}
	export class ToolMetadata {
	    id: string;
	    name: string;
	    description: string;
	    uiVisible: boolean;
	    enabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ToolMetadata(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.description = source["description"];
	        this.uiVisible = source["uiVisible"];
	        this.enabled = source["enabled"];
	    }
	}

}

